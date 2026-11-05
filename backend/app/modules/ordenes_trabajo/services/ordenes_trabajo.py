"""Consultas y reglas transaccionales del módulo de Órdenes de Trabajo.

Maquina de estados: Programada -> En Proceso -> Completada.
- El administrador crea/edita/elimina únicamente órdenes Programadas.
- El técnico asignado inicia (Programada -> En Proceso) y registra la evaluación.
- La finalización exige autorización comercial y completa el estado técnico de la orden.
"""

import unicodedata
from datetime import datetime
from typing import Any

from sqlalchemy import Integer, cast, delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, Proforma
from app.modules.empleados.models.empleado import Empleado
from app.modules.empleados.models.puesto_empleado import PuestoEmpleado
from app.modules.ordenes_trabajo.models.orden_trabajo import (
    EquipoOrden,
    EvaluacionOrden,
    EvaluacionOrdenMaterial,
    FinalizacionOrden,
    OrdenTrabajo,
)
from app.modules.ordenes_trabajo.models.tipo_trabajo import TipoTrabajo
from app.modules.ordenes_trabajo.schemas.orden_trabajo import (
    EquipoOrdenInput,
    EvaluacionMaterialInput,
    EvaluacionOrdenRegistro,
    EvaluacionOrdenUpdate,
    FinalizacionOrdenRegistro,
    OrdenTrabajoCreate,
    OrdenTrabajoUpdate,
)


class ClienteNotFoundError(Exception):
    """El cliente indicado no existe."""


class ClienteInactivoError(Exception):
    """El cliente existe pero está inactivo."""


class TipoTrabajoNotFoundError(Exception):
    """El tipo de trabajo indicado no existe."""


class TipoTrabajoInactivoError(Exception):
    """El tipo de trabajo está inactivo."""


class EmpleadoNotFoundError(Exception):
    """El empleado indicado no existe."""


class EmpleadoInactivoError(Exception):
    """El empleado o su puesto están inactivos."""


class EmpleadoSinPuestoTecnicoError(Exception):
    """El empleado no tiene el puesto activo de Técnico."""


class OrdenTrabajoNotFoundError(Exception):
    """La orden solicitada no existe."""


class EstadoOrdenError(Exception):
    """El estado actual no permite la operación solicitada."""


class TecnicoNoAsignadoError(Exception):
    """El empleado autenticado no es el técnico responsable de la orden."""


class EvaluacionOrdenNotFoundError(Exception):
    """La orden todavía no tiene evaluación."""


class EvaluacionOrdenExistenteError(Exception):
    """La orden ya posee una evaluación registrada."""


class EvaluacionEnCotizacionError(Exception):
    """La evaluación ya fue vinculada a una cotización; queda bloqueada su edición."""


class RequiereAprobacionComercialError(Exception):
    """La reparación o finalización requiere aprobación comercial real."""


class RequiereCotizacionCompletadaError(RequiereAprobacionComercialError):
    """La entrega exige la cotizacion COMPLETADA por registro en Cobros, aun sin dinero."""


class OrdenTrabajoConflictError(Exception):
    """Una restricción de integridad impidió la operación."""


def _normalize_position_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    ).casefold().strip()


def _orden_query():
    return (
        select(OrdenTrabajo)
        .options(joinedload(OrdenTrabajo.cliente))
        .options(joinedload(OrdenTrabajo.tipo_trabajo))
        .options(joinedload(OrdenTrabajo.empleado))
        .options(selectinload(OrdenTrabajo.equipo))
        .options(
            selectinload(OrdenTrabajo.evaluacion)
            .selectinload(EvaluacionOrden.materiales)
        )
        .options(joinedload(OrdenTrabajo.finalizacion))
    )


def _equipo_response(item: EquipoOrden) -> dict[str, Any]:
    return {
        "id_equipo": item.id_equipo,
        "id_orden": item.id_orden,
        "tipo_equipo": item.tipo_equipo,
        "marca": item.marca,
        "modelo": item.modelo,
        "numero_serie": item.numero_serie,
        "problema_reportado": item.problema_reportado,
        "accesorios_recibidos": item.accesorios_recibidos,
        "estado_recepcion": item.estado_recepcion,
        "observaciones": item.observaciones,
    }


def _evaluacion_response(item: EvaluacionOrden) -> dict[str, Any]:
    return {
        "id_evaluacion": item.id_evaluacion,
        "id_orden": item.id_orden,
        "fecha_evaluacion": item.fecha_evaluacion,
        "diagnostico": item.diagnostico,
        "trabajo_propuesto": item.trabajo_propuesto,
        "observaciones": item.observaciones,
        "materiales": [
            {
                "id_detalle": material.id_detalle,
                "id_evaluacion": material.id_evaluacion,
                "descripcion": material.descripcion,
                "cantidad": material.cantidad,
                "unidad": material.unidad,
            }
            for material in item.materiales
        ],
    }


def _finalizacion_response(item: FinalizacionOrden) -> dict[str, Any]:
    return {
        "id_finalizacion": item.id_finalizacion,
        "id_orden": item.id_orden,
        "trabajo_realizado": item.trabajo_realizado,
        "resultado_solucion": item.resultado_solucion,
        "observaciones_finales": item.observaciones_finales,
        "fecha_hora": item.fecha_hora,
        "evidencia_ruta": item.evidencia_ruta,
    }


def _evaluaciones_aceptadas(db: Session, id_ordenes: list[int]) -> set[int]:
    """Identificadores de evaluaciones de orden autorizadas para reparar.

    La cotización ACEPTADA o COMPLETADA por pago autoriza la reparación. También
    autoriza una cotización que ya posee Proforma: marca de una aceptación previa
    que el técnico conserva al reabrir la cotización para agregar trabajo
    adicional (EN PROCESO/GENERADA/RECHAZADA con Proforma)."""

    if not id_ordenes:
        return set()
    return set(
        db.scalars(
            select(Cotizacion.id_evaluacion_orden)
            .join(
                EvaluacionOrden,
                EvaluacionOrden.id_evaluacion == Cotizacion.id_evaluacion_orden,
            )
            .outerjoin(Proforma, Proforma.id_cotizacion == Cotizacion.id_cotizacion)
            .where(
                EvaluacionOrden.id_orden.in_(id_ordenes),
                or_(
                    Cotizacion.estado.in_(("ACEPTADA", "COMPLETADA")),
                    Proforma.id_proforma.is_not(None),
                ),
            )
        ).all()
    )


def _evaluaciones_rechazadas(db: Session, id_ordenes: list[int]) -> set[int]:
    """Identificadores de evaluaciones de orden con rechazo total.

    Solo cuentan las cotizaciones RECHAZADAS sin Proforma: si existe una
    aceptación previa (Proforma), el rechazo corresponde al trabajo adicional y no
    bloquea la reparación original. Se usa solo para informar al técnico."""

    if not id_ordenes:
        return set()
    return set(
        db.scalars(
            select(Cotizacion.id_evaluacion_orden)
            .join(
                EvaluacionOrden,
                EvaluacionOrden.id_evaluacion == Cotizacion.id_evaluacion_orden,
            )
            .outerjoin(Proforma, Proforma.id_cotizacion == Cotizacion.id_cotizacion)
            .where(
                EvaluacionOrden.id_orden.in_(id_ordenes),
                Cotizacion.estado == "RECHAZADA",
                Proforma.id_proforma.is_(None),
            )
        ).all()
    )


def _orden_response(
    orden: OrdenTrabajo,
    *,
    reparacion_autorizada: bool = False,
    trabajo_rechazado: bool = False,
) -> dict[str, Any]:
    cliente = orden.cliente
    tecnico = orden.empleado
    return {
        "id_orden": orden.id_orden,
        "codigo": orden.codigo,
        "id_cliente": orden.id_cliente,
        "nombre_cliente": f"{cliente.nombres} {cliente.apellidos}".strip(),
        "id_tipo_trabajo": orden.id_tipo_trabajo,
        "nombre_tipo_trabajo": orden.tipo_trabajo.nombre,
        "id_empleado": orden.id_empleado,
        "nombre_tecnico": f"{tecnico.nombres} {tecnico.apellidos}".strip(),
        "titulo": orden.titulo,
        "descripcion": orden.descripcion,
        "fecha_recepcion": orden.fecha_recepcion,
        "fecha_estimada": orden.fecha_estimada,
        "estado": orden.estado,
        "fecha_inicio": orden.fecha_inicio,
        "equipo": [_equipo_response(item) for item in orden.equipo],
        "evaluacion": None
        if orden.evaluacion is None
        else _evaluacion_response(orden.evaluacion),
        "finalizacion": None
        if orden.finalizacion is None
        else _finalizacion_response(orden.finalizacion),
        "puede_editar": orden.estado == "Programada",
        "puede_eliminar": orden.estado == "Programada",
        # La aceptación comercial real habilita la reparación/finalización técnica.
        "reparacion_autorizada": reparacion_autorizada,
        # El rechazo comercial se informa al técnico sin autorizar la reparación.
        "trabajo_rechazado": trabajo_rechazado,
        # La aprobación comercial queda pendiente mientras no exista reparación
        # autorizada; deja de estar pendiente solo con la cotización ACEPTADA.
        "aprobacion_comercial_pendiente": not reparacion_autorizada,
    }


def list_ordenes(db: Session, estado: str | None = None) -> list[dict[str, Any]]:
    query = _orden_query()
    if estado is not None:
        query = query.where(OrdenTrabajo.estado == estado)
    ordenes = db.scalars(
        query.order_by(
            OrdenTrabajo.fecha_recepcion.desc(),
            OrdenTrabajo.id_orden.desc(),
        )
    ).unique().all()
    id_ordenes = [orden.id_orden for orden in ordenes]
    aceptadas = _evaluaciones_aceptadas(db, id_ordenes)
    rechazadas = _evaluaciones_rechazadas(db, id_ordenes)
    return [
        _orden_response(
            orden,
            reparacion_autorizada=(
                orden.evaluacion is not None and orden.evaluacion.id_evaluacion in aceptadas
            ),
            trabajo_rechazado=(
                orden.evaluacion is not None and orden.evaluacion.id_evaluacion in rechazadas
            ),
        )
        for orden in ordenes
    ]


def get_orden_model(db: Session, id_orden: int) -> OrdenTrabajo | None:
    return db.scalar(_orden_query().where(OrdenTrabajo.id_orden == id_orden))


def get_orden(db: Session, id_orden: int) -> dict[str, Any] | None:
    orden = get_orden_model(db, id_orden)
    if orden is None:
        return None
    aceptadas = _evaluaciones_aceptadas(db, [id_orden])
    rechazadas = _evaluaciones_rechazadas(db, [id_orden])
    return _orden_response(
        orden,
        reparacion_autorizada=(
            orden.evaluacion is not None and orden.evaluacion.id_evaluacion in aceptadas
        ),
        trabajo_rechazado=(
            orden.evaluacion is not None and orden.evaluacion.id_evaluacion in rechazadas
        ),
    )


def _locked_orden(db: Session, id_orden: int) -> OrdenTrabajo | None:
    # El bloqueo se limita a la cabecera para no incluir los lados nullable de sus JOIN.
    return db.scalar(
        select(OrdenTrabajo)
        .where(OrdenTrabajo.id_orden == id_orden)
        .with_for_update(of=OrdenTrabajo)
    )


def _get_active_client(db: Session, id_cliente: int) -> Cliente:
    cliente = db.scalar(select(Cliente).where(Cliente.id_cliente == id_cliente))
    if cliente is None:
        raise ClienteNotFoundError
    if cliente.estado != "Activo":
        raise ClienteInactivoError
    return cliente


def _get_active_tipo(db: Session, id_tipo_trabajo: int) -> TipoTrabajo:
    tipo = db.get(TipoTrabajo, id_tipo_trabajo)
    if tipo is None:
        raise TipoTrabajoNotFoundError
    if tipo.estado != "Activo":
        raise TipoTrabajoInactivoError
    return tipo


def _get_active_technician(db: Session, id_empleado: int) -> Empleado:
    """Un técnico es un empleado activo cuyo puesto activo es 'Técnico'."""

    empleado = db.scalar(
        select(Empleado)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.id_empleado == id_empleado)
    )
    if empleado is None:
        raise EmpleadoNotFoundError
    if empleado.estado != "Activo":
        raise EmpleadoInactivoError
    if (
        empleado.puesto is None
        or empleado.puesto.estado != "Activo"
        or _normalize_position_name(empleado.puesto.nombre) != "tecnico"
    ):
        raise EmpleadoSinPuestoTecnicoError
    return empleado


def list_tecnicos_activos(db: Session) -> list[dict[str, Any]]:
    """Expone el catálogo mínimo de técnicos para el formulario de la orden."""

    empleados = db.scalars(
        select(Empleado)
        .join(Empleado.puesto)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.estado == "Activo", PuestoEmpleado.estado == "Activo")
        .order_by(Empleado.apellidos, Empleado.nombres, Empleado.id_empleado)
    ).unique().all()
    return [
        {
            "id_empleado": empleado.id_empleado,
            "codigo": empleado.codigo,
            "nombres": empleado.nombres,
            "apellidos": empleado.apellidos,
            "nombre_puesto": empleado.puesto.nombre,
        }
        for empleado in empleados
        if _normalize_position_name(empleado.puesto.nombre) == "tecnico"
    ]


def _generar_codigo(db: Session) -> str:
    """Serializa por año el correlativo; sin columna UNIQUE, la atomicidad se apoya
    en el advisory lock y en la validación de la API al confirmar la transacción."""

    anio = db.scalar(select(func.extract("year", func.current_timestamp())))
    if anio is None:
        raise RuntimeError("PostgreSQL no devolvió el año oficial")
    anio_int = int(anio)
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
        {"clave": f"ordenes_trabajo:{anio_int}"},
    )
    correlativo = db.scalar(
        select(
            func.max(
                cast(
                    func.substring(OrdenTrabajo.codigo, r"([0-9]+)$"),
                    Integer,
                )
            )
        ).where(OrdenTrabajo.codigo.like(f"OT-{anio_int}-%"))
    )
    return f"OT-{anio_int}-{(correlativo or 0) + 1:04d}"


def _equipo_models(id_orden: int, equipo: list[EquipoOrdenInput]) -> list[EquipoOrden]:
    return [
        EquipoOrden(
            id_orden=id_orden,
            tipo_equipo=item.tipo_equipo.strip(),
            marca=item.marca,
            modelo=item.modelo,
            numero_serie=item.numero_serie,
            problema_reportado=item.problema_reportado.strip(),
            accesorios_recibidos=item.accesorios_recibidos,
            estado_recepcion=item.estado_recepcion,
            observaciones=item.observaciones,
        )
        for item in equipo
    ]


def _replace_equipo(
    db: Session,
    id_orden: int,
    equipo: list[EquipoOrdenInput],
) -> None:
    """Reemplaza el conjunto completo de equipos asociados a la orden."""

    db.execute(delete(EquipoOrden).where(EquipoOrden.id_orden == id_orden))
    db.add_all(_equipo_models(id_orden, equipo))


def _commit_orden_response(db: Session, id_orden: int) -> dict[str, Any]:
    response = get_orden(db, id_orden)
    if response is None:
        raise RuntimeError("La orden guardada no pudo recuperarse")
    return response


def create_orden(db: Session, data: OrdenTrabajoCreate) -> dict[str, Any]:
    """Crea una orden Programada con su código, fecha oficial y equipo asociado."""

    try:
        _get_active_client(db, data.id_cliente)
        _get_active_tipo(db, data.id_tipo_trabajo)
        _get_active_technician(db, data.id_empleado)

        fecha_recepcion = db.scalar(select(func.localtimestamp()))
        if fecha_recepcion is None:
            raise RuntimeError("PostgreSQL no devolvió la fecha de recepción")

        orden = OrdenTrabajo(
            codigo=_generar_codigo(db),
            id_cliente=data.id_cliente,
            id_tipo_trabajo=data.id_tipo_trabajo,
            id_empleado=data.id_empleado,
            titulo=data.titulo.strip(),
            descripcion=data.descripcion.strip(),
            fecha_recepcion=fecha_recepcion,
            fecha_estimada=data.fecha_estimada,
            estado="Programada",
            fecha_inicio=None,
            equipo=[],
        )
        db.add(orden)
        db.flush()
        # El identificador de la orden se conoce solo después del flush.
        orden.equipo = _equipo_models(orden.id_orden, data.equipo)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OrdenTrabajoConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, orden.id_orden)


def update_orden(
    db: Session,
    orden: OrdenTrabajo,
    data: OrdenTrabajoUpdate,
) -> dict[str, Any]:
    """Edita la orden únicamente en estado Programada y reemplaza su equipo."""

    values = data.model_dump(exclude_unset=True)
    try:
        orden_bloqueada = _locked_orden(db, orden.id_orden)
        if orden_bloqueada is None:
            raise OrdenTrabajoConflictError
        if orden_bloqueada.estado != "Programada":
            raise EstadoOrdenError

        id_cliente = values.get("id_cliente", orden_bloqueada.id_cliente)
        id_tipo_trabajo = values.get(
            "id_tipo_trabajo", orden_bloqueada.id_tipo_trabajo
        )
        id_empleado = values.get("id_empleado", orden_bloqueada.id_empleado)
        if id_cliente is None or id_tipo_trabajo is None or id_empleado is None:
            raise OrdenTrabajoConflictError
        _get_active_client(db, id_cliente)
        _get_active_tipo(db, id_tipo_trabajo)
        _get_active_technician(db, id_empleado)

        for campo in (
            "id_cliente",
            "id_tipo_trabajo",
            "id_empleado",
            "titulo",
            "descripcion",
            "fecha_estimada",
        ):
            if campo in values:
                setattr(orden_bloqueada, campo, values[campo])
        if "equipo" in values:
            _replace_equipo(db, orden_bloqueada.id_orden, values["equipo"] or [])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OrdenTrabajoConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, orden.id_orden)


def delete_orden(db: Session, orden: OrdenTrabajo) -> dict[str, Any]:
    """Elimina la orden Programada y su equipo; las referencias a procesos la impiden."""

    try:
        orden_bloqueada = _locked_orden(db, orden.id_orden)
        if orden_bloqueada is None:
            raise OrdenTrabajoConflictError
        if orden_bloqueada.estado != "Programada":
            raise EstadoOrdenError
        response = _orden_response(orden_bloqueada)
        # La FK no tiene ON DELETE CASCADE: el equipo se elimina expresamente.
        db.execute(
            delete(EquipoOrden).where(EquipoOrden.id_orden == orden_bloqueada.id_orden)
        )
        db.flush()
        db.delete(orden_bloqueada)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OrdenTrabajoConflictError from exc
    except Exception:
        db.rollback()
        raise
    return response


def _require_responsable(orden: OrdenTrabajo, current_employee: Empleado) -> None:
    """Valida que la identidad del JWT corresponda al técnico asignado."""

    if orden.id_empleado != current_employee.id_empleado:
        raise TecnicoNoAsignadoError


def iniciar_orden(
    db: Session,
    id_orden: int,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Transiciona Programada -> En Proceso y registra la fecha de inicio."""

    try:
        orden = _locked_orden(db, id_orden)
        if orden is None:
            raise OrdenTrabajoNotFoundError
        _require_responsable(orden, current_employee)
        if orden.estado != "Programada":
            raise EstadoOrdenError

        fecha_inicio = db.scalar(select(func.localtimestamp()))
        if fecha_inicio is None:
            raise RuntimeError("PostgreSQL no devolvió la fecha de inicio")
        orden.estado = "En Proceso"
        orden.fecha_inicio = fecha_inicio
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, id_orden)


def _replace_materiales(
    db: Session,
    evaluacion: EvaluacionOrden,
    materiales: list[EvaluacionMaterialInput],
) -> None:
    """Reemplaza el conjunto de materiales/repuestos requeridos por la evaluación."""

    db.execute(
        delete(EvaluacionOrdenMaterial).where(
            EvaluacionOrdenMaterial.id_evaluacion == evaluacion.id_evaluacion
        )
    )
    db.add_all(
        EvaluacionOrdenMaterial(
            id_evaluacion=evaluacion.id_evaluacion,
            descripcion=material.descripcion.strip(),
            cantidad=material.cantidad,
            unidad=material.unidad,
        )
        for material in materiales
    )


def _validar_evaluacion_no_cotizada(db: Session, id_evaluacion: int) -> None:
    """Bloqueo comercial: una evaluación ya vinculada a una cotización no se edita."""

    if db.scalar(
        select(Cotizacion.id_cotizacion).where(
            Cotizacion.id_evaluacion_orden == id_evaluacion
        )
    ) is not None:
        raise EvaluacionEnCotizacionError


def _aplicar_evaluacion(
    evaluacion: EvaluacionOrden,
    data: EvaluacionOrdenRegistro,
) -> None:
    evaluacion.diagnostico = data.diagnostico.strip()
    evaluacion.trabajo_propuesto = data.trabajo_propuesto.strip()
    evaluacion.observaciones = data.observaciones


def registrar_evaluacion(
    db: Session,
    id_orden: int,
    data: EvaluacionOrdenRegistro,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Crea o reemplaza la evaluación técnica de una orden En Proceso.

    Guarda la evaluación una sola vez (crea o actualiza) junto con sus
    materiales; una vez vinculada a una cotización, la edición queda bloqueada.
    PostgreSQL no aplica UNIQUE sobre id_orden en esta tabla, por lo que la
    unicidad se garantiza dentro de la transacción."""

    try:
        orden = _locked_orden(db, id_orden)
        if orden is None:
            raise OrdenTrabajoNotFoundError
        _require_responsable(orden, current_employee)
        if orden.estado != "En Proceso":
            raise EstadoOrdenError

        evaluacion = db.scalar(
            select(EvaluacionOrden).where(EvaluacionOrden.id_orden == id_orden)
        )
        if evaluacion is not None:
            _validar_evaluacion_no_cotizada(db, evaluacion.id_evaluacion)
        else:
            evaluacion = EvaluacionOrden(id_orden=id_orden)
            db.add(evaluacion)
        # Los campos obligatorios deben aplicarse ANTES del flush: un INSERT de
        # la evaluación con diagnostico/trabajo_propuesto NULL violaría sus
        # restricciones NOT NULL (409 enmascarado como conflicto genérico).
        _aplicar_evaluacion(evaluacion, data)
        db.flush()
        _replace_materiales(db, evaluacion, data.materiales)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OrdenTrabajoConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, id_orden)


def actualizar_evaluacion(
    db: Session,
    id_orden: int,
    data: EvaluacionOrdenUpdate,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Actualiza de forma parcial la evaluación de una orden En Proceso.

    Solo el técnico asignado; la evaluación vinculada a una cotización queda
    bloqueada (aprobación comercial)."""

    values = data.model_dump(exclude_unset=True)
    try:
        orden = _locked_orden(db, id_orden)
        if orden is None:
            raise OrdenTrabajoNotFoundError
        _require_responsable(orden, current_employee)
        if orden.estado != "En Proceso":
            raise EstadoOrdenError

        evaluacion = db.scalar(
            select(EvaluacionOrden).where(EvaluacionOrden.id_orden == id_orden)
        )
        if evaluacion is None:
            raise EvaluacionOrdenNotFoundError
        _validar_evaluacion_no_cotizada(db, evaluacion.id_evaluacion)
        for campo in ("diagnostico", "trabajo_propuesto", "observaciones"):
            if campo in values:
                setattr(evaluacion, campo, values[campo])
        if "materiales" in data.model_fields_set:
            _replace_materiales(db, evaluacion, data.materiales or [])
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, id_orden)


def get_evaluacion(db: Session, id_orden: int) -> dict[str, Any] | None:
    evaluacion = db.scalar(
        select(EvaluacionOrden).where(EvaluacionOrden.id_orden == id_orden)
    )
    return None if evaluacion is None else _evaluacion_response(evaluacion)


def _evaluacion_y_autorizacion(
    db: Session, id_orden: int
) -> Cotizacion:
    """Devuelve la cotización que acredita la autorización comercial real.

    Conserva la aceptación respaldada por Proforma y permite reutilizar la
    cotización COMPLETADA para mantener la idempotencia del proceso técnico."""

    evaluacion = db.scalar(
        select(EvaluacionOrden).where(EvaluacionOrden.id_orden == id_orden)
    )
    if evaluacion is None:
        raise EvaluacionOrdenNotFoundError
    cotizacion = db.scalar(
        select(Cotizacion)
        .outerjoin(Proforma, Proforma.id_cotizacion == Cotizacion.id_cotizacion)
        .where(
            Cotizacion.id_evaluacion_orden == evaluacion.id_evaluacion,
            or_(
                Cotizacion.estado.in_(("ACEPTADA", "COMPLETADA")),
                Proforma.id_proforma.is_not(None),
            ),
        )
    )
    if cotizacion is None:
        raise RequiereAprobacionComercialError
    return cotizacion


def continuar_trabajo(
    db: Session,
    id_orden: int,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Valida que el técnico asignado pueda continuar la reparación.

    No cambia el estado de la orden; comprueba En Proceso y la aceptación
    comercial (ACEPTADA, COMPLETADA o Proforma previa) antes de liberar el bloqueo."""

    try:
        orden = _locked_orden(db, id_orden)
        if orden is None:
            raise OrdenTrabajoNotFoundError
        _require_responsable(orden, current_employee)
        if orden.estado != "En Proceso":
            raise EstadoOrdenError
        _evaluacion_y_autorizacion(db, id_orden)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, id_orden)


def finalizar_orden(
    db: Session,
    id_orden: int,
    data: FinalizacionOrdenRegistro,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Confirma la entrega del equipo reutilizando finalizacion_orden.

    Solo el tecnico asignado completa la orden: exige cotizacion COMPLETADA por
    registro en Cobros (pendiente, anticipo o total), aunque quede toda la deuda.
    No exige dinero recibido ni altera el estado comercial al entregar el equipo.
    """

    try:
        orden = _locked_orden(db, id_orden)
        if orden is None:
            raise OrdenTrabajoNotFoundError
        _require_responsable(orden, current_employee)
        if orden.estado not in ("En Proceso", "Completada"):
            raise EstadoOrdenError
        cotizacion = _evaluacion_y_autorizacion(db, id_orden)
        if cotizacion.estado != "COMPLETADA":
            raise RequiereCotizacionCompletadaError

        finalizacion = db.scalar(
            select(FinalizacionOrden).where(FinalizacionOrden.id_orden == id_orden)
        )
        # El bloqueo de la orden serializa envios simultaneos. Un reintento de
        # una entrega ya completada no crea filas ni modifica la evidencia original.
        if orden.estado == "Completada":
            if finalizacion is None:
                raise EstadoOrdenError
            db.commit()
            return _commit_orden_response(db, id_orden)
        if finalizacion is None:
            finalizacion = FinalizacionOrden(id_orden=id_orden)
            db.add(finalizacion)
            # La fecha de la primera finalización la define PostgreSQL para
            # conservarla al actualizar (la hora oficial no se pisa en updates).
            fecha_hora = db.scalar(select(func.localtimestamp()))
            if fecha_hora is None:
                raise RuntimeError("PostgreSQL no devolvió la fecha de finalización")
            finalizacion.fecha_hora = fecha_hora
        finalizacion.trabajo_realizado = data.trabajo_realizado.strip()
        finalizacion.resultado_solucion = data.resultado_solucion.strip()
        finalizacion.observaciones_finales = data.observaciones_finales
        finalizacion.evidencia_ruta = data.evidencia_ruta
        orden.estado = "Completada"
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OrdenTrabajoConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _commit_orden_response(db, id_orden)
