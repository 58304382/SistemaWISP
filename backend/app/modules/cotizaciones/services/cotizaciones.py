"""Reglas de negocio y transacciones de Cotizaciones y Proformas."""

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import Integer, cast, delete, exists, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, CotizacionDetalle, Proforma
from app.modules.ordenes_trabajo.models.orden_trabajo import (
    EvaluacionOrden,
    OrdenTrabajo,
)
from app.modules.ordenes_trabajo.models.tipo_trabajo import TipoTrabajo
from app.modules.visitas_tecnicas.models.evaluacion_visita import EvaluacionVisita
from app.modules.mapas.models.ubicacion import Municipio
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica
from app.modules.empleados.models.empleado import Empleado
from app.modules.cotizaciones.schemas.cotizacion import (
    CotizacionDirectaCreate,
    CotizacionEvaluacionCreate,
    CotizacionOrdenEvaluacionCreate,
    CotizacionUpdate,
    DetalleCotizacionInput,
    TrabajoAdicionalCreate,
)


MONEDA = Decimal("0.01")
ESTADOS_EDITABLES = {"EN PROCESO", "GENERADA"}
# El rechazo comercial solo es válido una vez emitida la cotización (GENERADA).
# Una evaluación todavía EN PROCESO debe completarse y generarse antes de que el
# cliente pueda aceptarla o rechazarla.
ESTADOS_RECHAZABLES = {"GENERADA"}


class CotizacionNotFoundError(Exception):
    pass


class ClienteNotFoundError(Exception):
    pass


class ClienteInactivoError(Exception):
    pass


class EvaluacionNotFoundError(Exception):
    pass


class EvaluacionConflictError(Exception):
    pass


class EvaluacionNoFinalizadaError(Exception):
    pass


class MaterialEvaluacionInvalidoError(Exception):
    pass


class EstadoCotizacionError(Exception):
    pass


class DetalleCotizacionError(Exception):
    pass


class CotizacionConflictError(Exception):
    pass


class EliminacionCotizacionError(Exception):
    pass


class ProformaNotFoundError(Exception):
    pass


class ProformaConflictError(Exception):
    pass


class EvaluacionOrdenNotFoundError(Exception):
    """La evaluación de la orden de trabajo no existe."""


class EvaluacionOrdenYaCotizadaError(Exception):
    """La evaluación de la orden ya posee una cotización vinculada."""


class TrabajoAdicionalEstadoError(Exception):
    """La cotización o la orden no permiten registrar trabajo adicional."""


class TrabajoAdicionalNoAutorizadoError(Exception):
    """El empleado autenticado no es el técnico asignado a la orden."""


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEDA, rounding=ROUND_HALF_UP)


def calcular_totales(
    detalles: list[CotizacionDetalle], porcentaje_descuento: Decimal
) -> tuple[list[Decimal], Decimal, Decimal, Decimal]:
    """Calcula importes sin persistirlos; un precio pendiente aporta cero al total."""

    subtotales = [
        _money(detalle.cantidad * (detalle.precio_unitario or Decimal("0.00")))
        for detalle in detalles
    ]
    subtotal = _money(sum(subtotales, start=Decimal("0.00")))
    monto_descuento = _money(subtotal * porcentaje_descuento / Decimal("100"))
    return subtotales, subtotal, monto_descuento, _money(subtotal - monto_descuento)


def _cotizacion_query():
    return (
        select(Cotizacion)
        .options(
            joinedload(Cotizacion.cliente)
            .joinedload(Cliente.municipio)
            .joinedload(Municipio.departamento)
        )
        .options(selectinload(Cotizacion.detalles))
        .options(joinedload(Cotizacion.proforma))
        .options(
            joinedload(Cotizacion.evaluacion_orden)
            .joinedload(EvaluacionOrden.orden)
            .joinedload(OrdenTrabajo.tipo_trabajo)
        )
    )


def _cotizacion_response(cotizacion: Cotizacion) -> dict[str, Any]:
    subtotales, subtotal, monto_descuento, total = calcular_totales(
        cotizacion.detalles, cotizacion.porcentaje_descuento
    )
    cliente = cotizacion.cliente
    municipio = cliente.municipio
    proforma = cotizacion.proforma
    evaluacion_orden = cotizacion.evaluacion_orden
    return {
        "id_cotizacion": cotizacion.id_cotizacion,
        "numero_cotizacion": cotizacion.numero_cotizacion,
        "fecha": cotizacion.fecha,
        "fecha_actualizacion": cotizacion.fecha_actualizacion,
        "origen": cotizacion.origen,
        "id_evaluacion": cotizacion.id_evaluacion,
        "id_evaluacion_orden": cotizacion.id_evaluacion_orden,
        "tipo_trabajo": None
        if evaluacion_orden is None or evaluacion_orden.orden is None
        else evaluacion_orden.orden.tipo_trabajo.nombre,
        "estado": cotizacion.estado,
        "porcentaje_descuento": cotizacion.porcentaje_descuento,
        "observaciones": cotizacion.observaciones,
        "cliente": {
            "id_cliente": cliente.id_cliente,
            "nombres": cliente.nombres,
            "apellidos": cliente.apellidos,
            "telefono": cliente.telefono,
            "direccion": cliente.direccion,
            "departamento": municipio.departamento.nombre,
            "municipio": municipio.nombre,
        },
        "detalles": [
            {
                "id_detalle": detalle.id_detalle,
                "descripcion": detalle.descripcion,
                "cantidad": detalle.cantidad,
                "unidad": detalle.unidad,
                "precio_unitario": detalle.precio_unitario,
                "subtotal_detalle": subtotales[index],
            }
            for index, detalle in enumerate(cotizacion.detalles)
        ],
        "subtotal": subtotal,
        "monto_descuento": monto_descuento,
        "total": total,
        "tiene_proforma": proforma is not None,
        "proforma": None
        if proforma is None
        else {
            "id_proforma": proforma.id_proforma,
            "fecha_generacion": proforma.fecha_generacion,
        },
    }


def list_cotizaciones(db: Session, estado: str | None = None) -> list[dict[str, Any]]:
    query = _cotizacion_query()
    if estado is not None:
        query = query.where(Cotizacion.estado == estado)
    cotizaciones = db.scalars(
        query.order_by(Cotizacion.fecha.desc(), Cotizacion.id_cotizacion.desc())
    ).unique().all()
    return [_cotizacion_response(cotizacion) for cotizacion in cotizaciones]


def get_cotizacion_model(db: Session, id_cotizacion: int) -> Cotizacion | None:
    return db.scalar(
        _cotizacion_query().where(Cotizacion.id_cotizacion == id_cotizacion)
    )


def get_cotizacion(db: Session, id_cotizacion: int) -> dict[str, Any] | None:
    cotizacion = get_cotizacion_model(db, id_cotizacion)
    return None if cotizacion is None else _cotizacion_response(cotizacion)


def _prepare_cotizacion_response(
    db: Session, id_cotizacion: int
) -> dict[str, Any]:
    """Construye la respuesta dentro de la transaccion para conservar rollback."""

    db.flush()
    db.expire_all()
    response = get_cotizacion(db, id_cotizacion)
    if response is None:
        raise RuntimeError("No se pudo recargar la cotizacion")
    return response


def _fecha_oficial(db: Session) -> date:
    fecha = db.scalar(select(func.current_date()))
    if fecha is None:
        raise RuntimeError("PostgreSQL no devolvio la fecha oficial")
    return fecha


def _generar_numero_cotizacion(db: Session, fecha: date) -> str:
    """Serializa por año el correlativo y deja la unicidad como respaldo final.

    El advisory lock dura hasta terminar la transaccion. Dos solicitudes del mismo
    año no pueden calcular simultaneamente el mismo siguiente valor; la constraint
    uq_cotizaciones_numero protege además ante escritores externos a esta API.
    """

    anio = fecha.year
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
        {"clave": f"cotizaciones:{anio}"},
    )
    correlativo = db.scalar(
        select(
            func.max(
                cast(
                    func.substring(Cotizacion.numero_cotizacion, r"([0-9]+)$"),
                    Integer,
                )
            )
        ).where(Cotizacion.numero_cotizacion.like(f"COT-{anio}-%"))
    )
    return f"COT-{anio}-{(correlativo or 0) + 1:04d}"


def _detalle_model(
    id_cotizacion: int, detalle: DetalleCotizacionInput
) -> CotizacionDetalle:
    return CotizacionDetalle(
        id_cotizacion=id_cotizacion,
        descripcion=detalle.descripcion,
        cantidad=detalle.cantidad,
        unidad=detalle.unidad,
        precio_unitario=detalle.precio_unitario,
    )


def _integrity_conflict(error: IntegrityError) -> CotizacionConflictError:
    constraint = getattr(getattr(error, "orig", None), "diag", None)
    constraint_name = getattr(constraint, "constraint_name", None)
    if constraint_name == "uq_cotizaciones_evaluacion":
        return CotizacionConflictError("La evaluacion ya tiene una cotizacion")
    if constraint_name == "uq_cotizaciones_evaluacion_orden":
        return CotizacionConflictError("La evaluacion de la orden ya tiene una cotizacion")
    if constraint_name == "uq_cotizaciones_numero":
        return CotizacionConflictError("El numero de cotizacion ya existe")
    if constraint_name == "uq_proformas_cotizacion":
        return CotizacionConflictError("La cotizacion ya tiene una proforma")
    return CotizacionConflictError("La operacion entra en conflicto con datos existentes")


def create_cotizacion_directa(
    db: Session, data: CotizacionDirectaCreate, creado_por: int
) -> dict[str, Any]:
    """Crea cabecera y detalles DIRECTOS en una unica transaccion."""

    try:
        cliente = db.get(Cliente, data.id_cliente)
        if cliente is None:
            raise ClienteNotFoundError
        if cliente.estado != "Activo":
            raise ClienteInactivoError

        fecha = _fecha_oficial(db)
        cotizacion = Cotizacion(
            numero_cotizacion=_generar_numero_cotizacion(db, fecha),
            id_cliente=cliente.id_cliente,
            id_evaluacion=None,
            origen="DIRECTA",
            fecha=fecha,
            porcentaje_descuento=data.porcentaje_descuento,
            observaciones=data.observaciones,
            estado="GENERADA",
            creado_por=creado_por,
        )
        db.add(cotizacion)
        db.flush()
        db.add_all(
            [_detalle_model(cotizacion.id_cotizacion, detalle) for detalle in data.detalles]
        )
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        db.rollback()
        raise


def create_cotizacion_evaluacion(
    db: Session,
    data: CotizacionEvaluacionCreate,
    creado_por: int,
    *,
    gestionar_transaccion: bool = True,
) -> dict[str, Any]:
    """Deriva cliente y copia materiales; el llamador puede conservar la transaccion."""

    try:
        evaluacion = db.scalar(
            select(EvaluacionVisita)
            .where(EvaluacionVisita.id_evaluacion == data.id_evaluacion)
            .with_for_update()
        )
        if evaluacion is None:
            raise EvaluacionNotFoundError
        if db.scalar(
            select(Cotizacion.id_cotizacion).where(
                Cotizacion.id_evaluacion == evaluacion.id_evaluacion
            )
        ) is not None:
            raise EvaluacionConflictError

        visita = evaluacion.visita
        if visita.estado != "Completada":
            raise EvaluacionNoFinalizadaError
        cliente = visita.cliente
        if cliente.estado != "Activo":
            raise ClienteInactivoError
        for material in evaluacion.materiales:
            if material.unidad is not None and len(material.unidad) > 20:
                raise MaterialEvaluacionInvalidoError

        fecha = _fecha_oficial(db)
        cotizacion = Cotizacion(
            numero_cotizacion=_generar_numero_cotizacion(db, fecha),
            id_cliente=visita.id_cliente,
            id_evaluacion=evaluacion.id_evaluacion,
            origen="EVALUACION",
            fecha=fecha,
            porcentaje_descuento=data.porcentaje_descuento,
            observaciones=data.observaciones,
            estado="EN PROCESO",
            creado_por=creado_por,
        )
        db.add(cotizacion)
        db.flush()
        db.add_all(
            [
                CotizacionDetalle(
                    id_cotizacion=cotizacion.id_cotizacion,
                    descripcion=material.descripcion,
                    cantidad=material.cantidad,
                    unidad=material.unidad,
                    precio_unitario=None,
                )
                for material in evaluacion.materiales
            ]
        )
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        if gestionar_transaccion:
            db.commit()
        return response
    except IntegrityError as error:
        if gestionar_transaccion:
            db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        if gestionar_transaccion:
            db.rollback()
        raise


def list_ordenes_evaluaciones_pendientes(db: Session) -> list[dict[str, Any]]:
    """Evaluaciones de órdenes aún sin cotización que las referencie.

    El estado «pendiente de cotizar» se deriva de la ausencia de
    cotizaciones.id_evaluacion_orden; no se requiere columna de estado."""

    evaluaciones = db.scalars(
        select(EvaluacionOrden)
        .options(
            joinedload(EvaluacionOrden.orden).joinedload(OrdenTrabajo.cliente),
            joinedload(EvaluacionOrden.orden).joinedload(OrdenTrabajo.tipo_trabajo),
            selectinload(EvaluacionOrden.materiales),
        )
        .where(
            ~exists(
                select(1).where(
                    Cotizacion.id_evaluacion_orden == EvaluacionOrden.id_evaluacion
                )
            )
        )
        .order_by(
            EvaluacionOrden.fecha_evaluacion.desc(),
            EvaluacionOrden.id_evaluacion.desc(),
        )
    ).unique().all()
    return [_evaluacion_orden_pendiente_response(item) for item in evaluaciones]


def _evaluacion_orden_pendiente_response(
    evaluacion: EvaluacionOrden,
) -> dict[str, Any]:
    orden = evaluacion.orden
    return {
        "id_evaluacion": evaluacion.id_evaluacion,
        "id_orden": orden.id_orden,
        "id_cliente": orden.id_cliente,
        "nombre_cliente": f"{orden.cliente.nombres} {orden.cliente.apellidos}".strip(),
        "nombre_tipo_trabajo": orden.tipo_trabajo.nombre,
        "trabajo_propuesto": evaluacion.trabajo_propuesto,
        "observaciones": evaluacion.observaciones,
        "fecha_evaluacion": evaluacion.fecha_evaluacion,
        "materiales": [
            {
                "descripcion": material.descripcion,
                "cantidad": material.cantidad,
                "unidad": material.unidad,
            }
            for material in evaluacion.materiales
        ],
    }


def create_cotizacion_orden_evaluacion(
    db: Session,
    data: CotizacionOrdenEvaluacionCreate,
    creado_por: int,
) -> dict[str, Any]:
    """Crea en estado EN PROCESO una cotización desde la evaluación de orden.

    Precarga cliente, trabajo propuesto y materiales con precios pendientes;
    el administrador fija precios después mediante el flujo existente."""

    try:
        evaluacion = db.scalar(
            select(EvaluacionOrden)
            .options(
                joinedload(EvaluacionOrden.orden).joinedload(OrdenTrabajo.cliente)
            )
            .where(EvaluacionOrden.id_evaluacion == data.id_evaluacion_orden)
            .with_for_update(of=EvaluacionOrden)
        )
        if evaluacion is None:
            raise EvaluacionOrdenNotFoundError
        if db.scalar(
            select(Cotizacion.id_cotizacion).where(
                Cotizacion.id_evaluacion_orden == evaluacion.id_evaluacion
            )
        ) is not None:
            raise EvaluacionOrdenYaCotizadaError

        orden = evaluacion.orden
        cliente = orden.cliente
        if cliente.estado != "Activo":
            raise ClienteInactivoError
        for material in evaluacion.materiales:
            if material.unidad is not None and len(material.unidad) > 20:
                raise MaterialEvaluacionInvalidoError

        fecha = _fecha_oficial(db)
        cotizacion = Cotizacion(
            numero_cotizacion=_generar_numero_cotizacion(db, fecha),
            id_cliente=orden.id_cliente,
            id_evaluacion=None,
            id_evaluacion_orden=evaluacion.id_evaluacion,
            origen="ORDEN_TRABAJO",
            fecha=fecha,
            porcentaje_descuento=data.porcentaje_descuento,
            observaciones=data.observaciones,
            estado="EN PROCESO",
            creado_por=creado_por,
        )
        db.add(cotizacion)
        db.flush()
        db.add_all(
            [
                CotizacionDetalle(
                    id_cotizacion=cotizacion.id_cotizacion,
                    descripcion=material.descripcion,
                    cantidad=material.cantidad,
                    unidad=material.unidad,
                    precio_unitario=None,
                )
                for material in evaluacion.materiales
            ]
        )
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        db.rollback()
        raise


def _cotizacion_for_update(db: Session, id_cotizacion: int) -> Cotizacion:
    # PostgreSQL debe bloquear solo la cabecera. Las relaciones opcionales usan
    # LEFT JOIN y no son objetivos validos de FOR UPDATE.
    cotizacion = db.scalar(
        select(Cotizacion)
        .where(Cotizacion.id_cotizacion == id_cotizacion)
        .with_for_update(of=Cotizacion)
    )
    if cotizacion is None:
        raise CotizacionNotFoundError
    return cotizacion


def _validar_detalles_edicion(
    cotizacion: Cotizacion, detalles: list[DetalleCotizacionInput]
) -> None:
    if (cotizacion.origen == "DIRECTA" or cotizacion.estado == "GENERADA") and any(
        detalle.precio_unitario is None for detalle in detalles
    ):
        raise DetalleCotizacionError


def update_cotizacion(
    db: Session, id_cotizacion: int, data: CotizacionUpdate
) -> dict[str, Any]:
    """Reemplaza detalles y cabecera editable sin alterar fecha oficial ni relaciones."""

    try:
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if cotizacion.estado not in ESTADOS_EDITABLES:
            raise EstadoCotizacionError

        changes = data.model_dump(exclude_unset=True, exclude={"detalles"})
        for field, value in changes.items():
            setattr(cotizacion, field, value)
        detalles_nuevos = data.detalles if "detalles" in data.model_fields_set else None
        if detalles_nuevos is not None:
            detalles = detalles_nuevos
            _validar_detalles_edicion(cotizacion, detalles)
            db.execute(
                delete(CotizacionDetalle).where(
                    CotizacionDetalle.id_cotizacion == cotizacion.id_cotizacion
                )
            )
            db.add_all(
                [_detalle_model(cotizacion.id_cotizacion, detalle) for detalle in detalles]
            )
        # Guardar precios no genera la cotizacion. La promocion de una Evaluacion
        # se realiza exclusivamente mediante generar_cotizacion_evaluacion().
        cotizacion.fecha_actualizacion = datetime.now()
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        db.rollback()
        raise


def _validar_generacion_evaluacion(
    cotizacion: Cotizacion, detalles: list[CotizacionDetalle]
) -> None:
    """Valida la integridad comercial antes de la transicion explicita."""

    if cotizacion.porcentaje_descuento is None or not (
        Decimal("0.00")
        <= cotizacion.porcentaje_descuento
        <= Decimal("100.00")
    ):
        raise DetalleCotizacionError
    if not detalles:
        raise DetalleCotizacionError
    if any(
        not detalle.descripcion
        or not detalle.descripcion.strip()
        or detalle.cantidad is None
        or detalle.cantidad <= 0
        or detalle.precio_unitario is None
        or detalle.precio_unitario < 0
        or (detalle.unidad is not None and len(detalle.unidad) > 20)
        for detalle in detalles
    ):
        raise DetalleCotizacionError


def generar_cotizacion_evaluacion(
    db: Session, id_cotizacion: int
) -> dict[str, Any]:
    """Transiciona atomicamente de EN PROCESO a GENERADA.

    Aplica a cotizaciones originadas en evaluaciones de visita (EVALUACION) y
    en evaluaciones de órdenes de trabajo (ORDEN_TRABAJO); las directas no
    requieren generación porque nacen ya GENERADAS."""

    try:
        # El mismo bloqueo de cabecera usado por PATCH serializa guardar y generar.
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if (
            cotizacion.origen not in {"EVALUACION", "ORDEN_TRABAJO"}
            or cotizacion.estado != "EN PROCESO"
        ):
            raise EstadoCotizacionError
        detalles = list(
            db.scalars(
                select(CotizacionDetalle)
                .where(CotizacionDetalle.id_cotizacion == id_cotizacion)
                .with_for_update()
            ).all()
        )
        _validar_generacion_evaluacion(cotizacion, detalles)
        cotizacion.estado = "GENERADA"
        cotizacion.fecha_actualizacion = datetime.now()
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        # Cualquier validacion o fallo transaccional conserva EN PROCESO en BD.
        db.rollback()
        raise


def _cambiar_estado(
    db: Session, id_cotizacion: int, estado_origen: set[str], estado_destino: str
) -> dict[str, Any]:
    try:
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if cotizacion.estado not in estado_origen:
            raise EstadoCotizacionError
        cotizacion.estado = estado_destino
        cotizacion.fecha_actualizacion = datetime.now()
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        db.rollback()
        raise


def aceptar_cotizacion(db: Session, id_cotizacion: int) -> dict[str, Any]:
    return _cambiar_estado(db, id_cotizacion, {"GENERADA"}, "ACEPTADA")


def rechazar_cotizacion(db: Session, id_cotizacion: int) -> dict[str, Any]:
    return _cambiar_estado(db, id_cotizacion, ESTADOS_RECHAZABLES, "RECHAZADA")


def _asegurar_proforma_previa(db: Session, cotizacion: Cotizacion) -> None:
    """Garantiza la Proforma como marca inmutable de la aceptación previa.

    Sin columnas nuevas, la Proforma existente certifica que la cotización ya fue
    ACEPTADA. Se crea aquí (si faltaba) para conservar la autorización del trabajo
    original cuando el técnico reabre la cotización y agrega trabajo adicional."""

    if db.scalar(
        select(Proforma.id_proforma).where(
            Proforma.id_cotizacion == cotizacion.id_cotizacion
        )
    ) is None:
        # La Proforma sólo referencia la cotización; sus datos se derivan de ella.
        db.add(Proforma(id_cotizacion=cotizacion.id_cotizacion))
        db.flush()


def registrar_trabajo_adicional(
    db: Session,
    id_cotizacion: int,
    data: TrabajoAdicionalCreate,
    current_employee: Empleado,
) -> dict[str, Any]:
    """Agrega trabajo adicional del técnico reutilizando la cotización vigente.

    Reglas de negocio:
    - Sólo aplica a cotizaciones de ORDEN_TRABAJO ligadas a una evaluación.
    - La cotización debe estar ACEPTADA (o RECHAZADA con Proforma previa) para
      volver a EN PROCESO y dejar que el administrador fije los precios y la
      regenere (EN PROCESO → GENERADA → ACEPTADA/RECHAZADA).
    - El empleado autenticado debe ser el técnico asignado y la orden seguir En
      Proceso.
    - Los conceptos se agregan SIN precio (pendiente) y no se eliminan los
      detalles previos: se conserva la información ya autorizada.
    - La autorización previa se conserva mediante la Proforma (marca real de una
      aceptación anterior), sin crear columnas ni tablas nuevas."""

    try:
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if (
            cotizacion.origen != "ORDEN_TRABAJO"
            or cotizacion.id_evaluacion_orden is None
        ):
            raise TrabajoAdicionalEstadoError

        evaluacion = db.get(EvaluacionOrden, cotizacion.id_evaluacion_orden)
        if evaluacion is None or evaluacion.orden is None:
            raise EvaluacionOrdenNotFoundError
        orden = evaluacion.orden
        if orden.id_empleado != current_employee.id_empleado:
            raise TrabajoAdicionalNoAutorizadoError
        if orden.estado != "En Proceso":
            raise TrabajoAdicionalEstadoError

        # Primera aceptación (ACEPTADA) o ciclo posterior (RECHAZADA con Proforma
        # existente). Cualquier otro estado no permite reabrir la cotización.
        if cotizacion.estado == "ACEPTADA":
            _asegurar_proforma_previa(db, cotizacion)
        elif cotizacion.estado == "RECHAZADA" and db.scalar(
            select(Proforma.id_proforma).where(
                Proforma.id_cotizacion == cotizacion.id_cotizacion
            )
        ) is not None:
            pass
        else:
            raise TrabajoAdicionalEstadoError

        db.add_all(
            [
                CotizacionDetalle(
                    id_cotizacion=cotizacion.id_cotizacion,
                    descripcion=detalle.descripcion,
                    cantidad=detalle.cantidad,
                    unidad=detalle.unidad,
                    precio_unitario=None,
                )
                for detalle in data.detalles
            ]
        )
        cotizacion.estado = "EN PROCESO"
        cotizacion.fecha_actualizacion = datetime.now()
        response = _prepare_cotizacion_response(db, cotizacion.id_cotizacion)
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise _integrity_conflict(error) from error
    except Exception:
        db.rollback()
        raise


def delete_cotizacion(db: Session, id_cotizacion: int) -> None:
    """Elimina solo DIRECTAS sin Proforma; no usa cascadas para omitir reglas."""

    try:
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if cotizacion.origen != "DIRECTA":
            raise EliminacionCotizacionError("Una cotizacion de evaluacion no se elimina")
        if db.scalar(
            select(Proforma.id_proforma).where(
                Proforma.id_cotizacion == cotizacion.id_cotizacion
            )
        ) is not None:
            raise EliminacionCotizacionError("La cotizacion ya tiene una proforma")
        db.execute(
            delete(CotizacionDetalle).where(
                CotizacionDetalle.id_cotizacion == cotizacion.id_cotizacion
            )
        )
        db.delete(cotizacion)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise EliminacionCotizacionError(
            "La cotizacion tiene un proceso posterior dependiente"
        ) from error
    except Exception:
        db.rollback()
        raise


def _proforma_response(proforma: Proforma, cotizacion: Cotizacion) -> dict[str, Any]:
    return {
        "id_proforma": proforma.id_proforma,
        "fecha_generacion": proforma.fecha_generacion,
        "cotizacion": _cotizacion_response(cotizacion),
    }


def generar_proforma(db: Session, id_cotizacion: int) -> dict[str, Any]:
    """Genera una unica referencia a la Cotizacion ACEPTADA de forma atomica."""

    try:
        cotizacion = _cotizacion_for_update(db, id_cotizacion)
        if cotizacion.estado != "ACEPTADA":
            raise EstadoCotizacionError
        if db.scalar(
            select(Proforma.id_proforma).where(
                Proforma.id_cotizacion == cotizacion.id_cotizacion
            )
        ) is not None:
            raise ProformaConflictError
        proforma = Proforma(id_cotizacion=cotizacion.id_cotizacion)
        db.add(proforma)
        db.flush()
        db.expire_all()
        response = get_proforma_por_cotizacion(db, cotizacion.id_cotizacion)
        if response is None:
            raise RuntimeError("No se pudo recargar la proforma")
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        raise ProformaConflictError from error
    except Exception:
        db.rollback()
        raise


def _get_proforma_model(
    db: Session, *, id_proforma: int | None = None, id_cotizacion: int | None = None
) -> Proforma | None:
    query = select(Proforma).options(
        joinedload(Proforma.cotizacion)
        .joinedload(Cotizacion.cliente)
        .joinedload(Cliente.municipio)
        .joinedload(Municipio.departamento),
        joinedload(Proforma.cotizacion).joinedload(Cotizacion.proforma),
        joinedload(Proforma.cotizacion).selectinload(Cotizacion.detalles),
    )
    if id_proforma is not None:
        query = query.where(Proforma.id_proforma == id_proforma)
    else:
        query = query.where(Proforma.id_cotizacion == id_cotizacion)
    return db.scalar(query)


def get_proforma(db: Session, id_proforma: int) -> dict[str, Any] | None:
    proforma = _get_proforma_model(db, id_proforma=id_proforma)
    return (
        None
        if proforma is None
        else _proforma_response(proforma, proforma.cotizacion)
    )


def get_proforma_por_cotizacion(
    db: Session, id_cotizacion: int
) -> dict[str, Any] | None:
    proforma = _get_proforma_model(db, id_cotizacion=id_cotizacion)
    return (
        None
        if proforma is None
        else _proforma_response(proforma, proforma.cotizacion)
    )
