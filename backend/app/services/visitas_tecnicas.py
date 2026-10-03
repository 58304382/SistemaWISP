"""Consultas y reglas transaccionales para visitas y sus evaluaciones."""

from collections.abc import Mapping
import logging
from pathlib import Path
from typing import Any
import unicodedata

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.cliente import Cliente
from app.models.empleado import Empleado
from app.models.evaluacion_visita import (
    EvaluacionVisita,
    EvaluacionVisitaMaterial,
)
from app.models.puesto_empleado import PuestoEmpleado
from app.models.tipo_instalacion import TipoInstalacion
from app.models.ubicacion_cliente import UbicacionCliente
from app.models.visita_tecnica import VisitaTecnica
from app.schemas.cotizacion import CotizacionEvaluacionCreate
from app.schemas.ubicacion_cliente import UbicacionClienteCreate
from app.schemas.visita_tecnica import (
    EvaluacionMaterialInput,
    EvaluacionVisitaCreate,
    EvaluacionVisitaDraft,
    EvaluacionVisitaFinalizar,
    PrimeraUbicacionVisitaCreate,
    VisitaTecnicaCreate,
    VisitaTecnicaUpdate,
)
from app.services.cotizaciones import (
    ClienteInactivoError as CotizacionClienteInactivoError,
    CotizacionConflictError,
    EvaluacionConflictError,
    EvaluacionNoFinalizadaError,
    EvaluacionNotFoundError as CotizacionEvaluacionNotFoundError,
    MaterialEvaluacionInvalidoError,
    create_cotizacion_evaluacion,
)
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    image_url,
    remove_image_file,
    safe_image_path,
    store_image,
)
from app.services.ubicaciones_cliente import (
    create_ubicacion_cliente_in_transaction,
    get_ubicacion_cliente,
)


IMAGE_DIRECTORY = "visitas_tecnicas"
logger = logging.getLogger(__name__)


class ClienteInactivoError(Exception):
    """El cliente no existe o no esta activo."""


class UbicacionClienteNotFoundError(Exception):
    """La propiedad indicada no existe."""


class UbicacionClienteNoPerteneceError(Exception):
    """La propiedad no pertenece al cliente de la visita."""


class UbicacionClienteInactivaError(Exception):
    """La propiedad indicada no esta activa."""


class TipoInstalacionInactivoError(Exception):
    """El tipo no existe o no esta activo."""


class EmpleadoNotFoundError(Exception):
    """El empleado no existe."""


class EmpleadoInactivoError(Exception):
    """El empleado o su puesto no esta activo."""


class EmpleadoSinPuestoTecnicoError(Exception):
    """El puesto activo del empleado no se llama Tecnico."""


class VisitaConflictError(Exception):
    """Una restriccion de integridad impidio la operacion."""


class EstadoVisitaError(Exception):
    """El estado actual no permite la mutacion solicitada."""


class EvaluacionNotFoundError(Exception):
    """La visita todavia no tiene evaluacion."""


class VisitaNoAsignadaError(Exception):
    """El empleado autenticado no es responsable de la visita."""


class UbicacionVisitaExistenteError(Exception):
    """La visita ya tiene una propiedad vinculada."""


def _visit_query():
    return (
        select(VisitaTecnica)
        .options(joinedload(VisitaTecnica.cliente))
        .options(joinedload(VisitaTecnica.ubicacion))
        .options(joinedload(VisitaTecnica.empleado))
        .options(joinedload(VisitaTecnica.tipo_instalacion))
        .options(
            selectinload(VisitaTecnica.evaluacion).selectinload(
                EvaluacionVisita.materiales
            )
        )
    )


def _evaluation_response(evaluation: EvaluacionVisita) -> dict[str, Any]:
    return {
        "id_evaluacion": evaluation.id_evaluacion,
        "id_visita": evaluation.id_visita,
        "descripcion_trabajo": evaluation.descripcion_trabajo,
        "tecnicos_recomendados": evaluation.tecnicos_recomendados,
        "condiciones_lugar": evaluation.condiciones_lugar,
        "observacion_tecnica": evaluation.observacion_tecnica,
        "materiales": [
            {
                "id_detalle": material.id_detalle,
                "descripcion": material.descripcion,
                "cantidad": material.cantidad,
                "unidad": material.unidad,
            }
            for material in evaluation.materiales
        ],
    }


def _visit_response(visit: VisitaTecnica) -> dict[str, Any]:
    client_name = f"{visit.cliente.nombres} {visit.cliente.apellidos}".strip()
    technician_name = f"{visit.empleado.nombres} {visit.empleado.apellidos}".strip()
    return {
        "id_visita": visit.id_visita,
        "id_cliente": visit.id_cliente,
        "id_ubicacion": visit.id_ubicacion,
        "numero_propiedad": (
            None if visit.ubicacion is None else visit.ubicacion.numero_propiedad
        ),
        "nombre_cliente": client_name,
        "telefono_cliente": visit.cliente.telefono,
        "direccion_cliente": visit.cliente.direccion,
        "id_empleado": visit.id_empleado,
        "nombre_tecnico": technician_name,
        "id_tipo_instalacion": visit.id_tipo_instalacion,
        "nombre_tipo_instalacion": visit.tipo_instalacion.nombre,
        "fecha_programada": visit.fecha_programada,
        "hora_programada": visit.hora_programada,
        "motivo_visita": visit.motivo_visita,
        "foto_referencia": image_url(visit.foto_referencia),
        "indicaciones": visit.indicaciones,
        "observaciones": visit.observaciones,
        "estado": visit.estado,
        "evaluacion": (
            None
            if visit.evaluacion is None
            else _evaluation_response(visit.evaluacion)
        ),
    }


def list_visitas(
    db: Session, estado: str | None = None
) -> list[dict[str, Any]]:
    query = _visit_query()
    if estado is not None:
        query = query.where(VisitaTecnica.estado == estado)
    visits = db.scalars(
        query.order_by(
            VisitaTecnica.fecha_programada,
            VisitaTecnica.hora_programada,
            VisitaTecnica.id_visita,
        )
    ).unique().all()
    return [_visit_response(visit) for visit in visits]


def get_visita_model(db: Session, id_visita: int) -> VisitaTecnica | None:
    return db.scalar(_visit_query().where(VisitaTecnica.id_visita == id_visita))


def get_visita(db: Session, id_visita: int) -> dict[str, Any] | None:
    visit = get_visita_model(db, id_visita)
    return None if visit is None else _visit_response(visit)


def _committed_visit(db: Session, id_visita: int) -> dict[str, Any]:
    visit = get_visita(db, id_visita)
    if visit is None:
        raise RuntimeError("La visita guardada no pudo recuperarse")
    return visit


def _validate_active_client(db: Session, id_cliente: int) -> None:
    if db.scalar(
        select(Cliente.id_cliente).where(
            Cliente.id_cliente == id_cliente, Cliente.estado == "Activo"
        )
    ) is None:
        raise ClienteInactivoError


def _validate_client_location(
    db: Session, id_ubicacion: int | None, id_cliente: int
) -> None:
    """Valida en backend la propiedad opcional y su pertenencia al cliente."""

    if id_ubicacion is None:
        return
    location = db.get(UbicacionCliente, id_ubicacion)
    if location is None:
        raise UbicacionClienteNotFoundError
    if location.id_cliente != id_cliente:
        raise UbicacionClienteNoPerteneceError
    if location.estado != "Activo":
        raise UbicacionClienteInactivaError


def _validate_active_type(db: Session, id_tipo_instalacion: int) -> None:
    if db.scalar(
        select(TipoInstalacion.id_tipo_instalacion).where(
            TipoInstalacion.id_tipo_instalacion == id_tipo_instalacion,
            TipoInstalacion.estado == "Activo",
        )
    ) is None:
        raise TipoInstalacionInactivoError


def _normalize_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(
        character
        for character in decomposed
        if unicodedata.category(character) != "Mn"
    ).casefold().strip()


def _validate_active_technician(db: Session, id_empleado: int) -> None:
    employee = db.scalar(
        select(Empleado)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.id_empleado == id_empleado)
    )
    if employee is None:
        raise EmpleadoNotFoundError
    if employee.estado != "Activo" or employee.puesto.estado != "Activo":
        raise EmpleadoInactivoError
    # El nombre se compara normalizado porque el catalogo usa "Técnico" y no un id fijo.
    if _normalize_name(employee.puesto.nombre) != "tecnico":
        raise EmpleadoSinPuestoTecnicoError


def list_tecnicos_activos(db: Session) -> list[dict[str, Any]]:
    employees = db.scalars(
        select(Empleado)
        .join(Empleado.puesto)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.estado == "Activo", PuestoEmpleado.estado == "Activo")
        .order_by(Empleado.apellidos, Empleado.nombres)
    ).unique().all()
    return [
        {
            "id_empleado": employee.id_empleado,
            "codigo": employee.codigo,
            "nombres": employee.nombres,
            "apellidos": employee.apellidos,
            "nombre_puesto": employee.puesto.nombre,
        }
        for employee in employees
        if _normalize_name(employee.puesto.nombre) == "tecnico"
    ]


def create_visita(
    db: Session,
    data: VisitaTecnicaCreate,
    photo_content: bytes | None = None,
) -> dict[str, Any]:
    _validate_active_client(db, data.id_cliente)
    _validate_client_location(db, data.id_ubicacion, data.id_cliente)
    _validate_active_type(db, data.id_tipo_instalacion)
    _validate_active_technician(db, data.id_empleado)

    visit = VisitaTecnica(
        id_cliente=data.id_cliente,
        id_ubicacion=data.id_ubicacion,
        id_empleado=data.id_empleado,
        id_tipo_instalacion=data.id_tipo_instalacion,
        fecha_programada=data.fecha_programada,
        hora_programada=data.hora_programada,
        motivo_visita=data.motivo_visita,
        indicaciones=data.indicaciones,
        observaciones=data.observaciones,
        estado="Programada",
    )
    db.add(visit)
    stored_photo: Path | None = None
    try:
        db.flush()
        if photo_content is not None:
            relative_path, stored_photo = store_image(
                photo_content, IMAGE_DIRECTORY, "visita", visit.id_visita
            )
            visit.foto_referencia = relative_path
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if stored_photo is not None:
            remove_image_file(stored_photo)
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        if stored_photo is not None:
            remove_image_file(stored_photo)
        raise
    return _committed_visit(db, visit.id_visita)


def update_visita(
    db: Session, visit: VisitaTecnica, data: VisitaTecnicaUpdate
) -> dict[str, Any]:
    if visit.estado != "Programada":
        raise EstadoVisitaError
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    # Revalida las asociaciones efectivas, incluso si el PATCH solo cambia texto.
    effective_client_id = values.get("id_cliente", visit.id_cliente)
    effective_location_id = values.get("id_ubicacion", visit.id_ubicacion)
    _validate_active_client(db, effective_client_id)
    # También detecta cambios de cliente que dejarían asociada una propiedad anterior.
    _validate_client_location(db, effective_location_id, effective_client_id)
    _validate_active_type(
        db, values.get("id_tipo_instalacion", visit.id_tipo_instalacion)
    )
    _validate_active_technician(db, values.get("id_empleado", visit.id_empleado))

    for field in (
        "id_cliente",
        "id_ubicacion",
        "id_empleado",
        "id_tipo_instalacion",
        "fecha_programada",
        "hora_programada",
        "motivo_visita",
        "indicaciones",
        "observaciones",
    ):
        if field in values:
            setattr(visit, field, values[field])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_visit(db, visit.id_visita)


def replace_reference_photo(
    db: Session, visit: VisitaTecnica, content: bytes
) -> dict[str, Any]:
    if visit.estado != "Programada":
        raise EstadoVisitaError
    old_photo = (
        None
        if visit.foto_referencia is None
        else safe_image_path(visit.foto_referencia, IMAGE_DIRECTORY)
    )
    relative_path, stored_photo = store_image(
        content, IMAGE_DIRECTORY, "visita", visit.id_visita
    )
    visit.foto_referencia = relative_path
    try:
        db.commit()
    except Exception:
        db.rollback()
        remove_image_file(stored_photo)
        raise
    if old_photo is not None and old_photo != stored_photo:
        try:
            remove_image_file(old_photo)
        except (ImagePathError, ImageStorageError):
            logger.warning("No se pudo eliminar la foto anterior de la visita", exc_info=True)
    return _committed_visit(db, visit.id_visita)


def remove_reference_photo(db: Session, visit: VisitaTecnica) -> dict[str, Any]:
    if visit.estado != "Programada":
        raise EstadoVisitaError
    old_photo = (
        None
        if visit.foto_referencia is None
        else safe_image_path(visit.foto_referencia, IMAGE_DIRECTORY)
    )
    visit.foto_referencia = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    if old_photo is not None:
        try:
            remove_image_file(old_photo)
        except (ImagePathError, ImageStorageError):
            logger.warning("No se pudo eliminar la foto retirada de la visita", exc_info=True)
    return _committed_visit(db, visit.id_visita)


def registrar_primera_ubicacion(
    db: Session,
    id_visita: int,
    data: PrimeraUbicacionVisitaCreate,
    current_employee_id: int,
    image_content: bytes | None = None,
) -> dict[str, Any] | None:
    """Crea la propiedad y vincula la visita dentro de una sola transacción."""

    saved_image: Path | None = None
    try:
        # El bloqueo serializa solicitudes concurrentes para la misma visita.
        visit = _locked_visit(db, id_visita)
        if visit is None:
            return None
        # La identidad laboral proviene del JWT; nunca se acepta desde el formulario.
        if visit.id_empleado != current_employee_id:
            raise VisitaNoAsignadaError
        if visit.estado not in {"Programada", "En Proceso"}:
            raise EstadoVisitaError
        if visit.id_ubicacion is not None:
            raise UbicacionVisitaExistenteError

        location, saved_image = create_ubicacion_cliente_in_transaction(
            db,
            UbicacionClienteCreate(
                id_cliente=visit.id_cliente,
                direccion=data.direccion,
                referencia=data.referencia,
                observaciones=data.observaciones,
                latitud=data.latitud,
                longitud=data.longitud,
            ),
            image_content,
        )
        visit.id_ubicacion = location.id_ubicacion
        db.flush()
        # Construir la respuesta antes del commit mantiene atómica toda posible falla.
        response = get_ubicacion_cliente(db, location.id_ubicacion)
        if response is None:
            raise RuntimeError("La propiedad creada no pudo recuperarse")
        db.commit()
        return response
    except IntegrityError as error:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise VisitaConflictError from error
    except Exception:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise


def delete_visita(db: Session, visit: VisitaTecnica) -> dict[str, Any]:
    if visit.estado != "Programada":
        raise EstadoVisitaError
    response = _visit_response(visit)
    old_photo = (
        None
        if visit.foto_referencia is None
        else safe_image_path(visit.foto_referencia, IMAGE_DIRECTORY)
    )
    db.delete(visit)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        raise
    if old_photo is not None:
        try:
            remove_image_file(old_photo)
        except (ImagePathError, ImageStorageError):
            logger.warning("No se pudo eliminar la foto de la visita borrada", exc_info=True)
    return response


def _locked_visit(db: Session, id_visita: int) -> VisitaTecnica | None:
    # El bloqueo se limita a la visita para no incluir los lados nullable de sus LEFT JOIN.
    return db.scalar(
        select(VisitaTecnica)
        .where(VisitaTecnica.id_visita == id_visita)
        .with_for_update(of=VisitaTecnica)
    )


def _replace_materials(
    db: Session,
    evaluation: EvaluacionVisita,
    materials: list[EvaluacionMaterialInput],
) -> None:
    db.execute(
        delete(EvaluacionVisitaMaterial).where(
            EvaluacionVisitaMaterial.id_evaluacion == evaluation.id_evaluacion
        )
    )
    db.add_all(
        EvaluacionVisitaMaterial(
            id_evaluacion=evaluation.id_evaluacion,
            descripcion=material.descripcion,
            cantidad=material.cantidad,
            unidad=material.unidad,
        )
        for material in materials
    )


def iniciar_evaluacion(
    db: Session,
    id_visita: int,
    data: EvaluacionVisitaCreate,
    current_employee_id: int,
) -> dict[str, Any] | None:
    visit = _locked_visit(db, id_visita)
    if visit is None:
        return None
    # La asignación se valida sobre la fila bloqueada y con la identidad del JWT.
    if visit.id_empleado != current_employee_id:
        raise VisitaNoAsignadaError
    if visit.estado != "Programada":
        raise EstadoVisitaError

    evaluation = EvaluacionVisita(
        id_visita=id_visita,
        descripcion_trabajo=data.descripcion_trabajo,
        tecnicos_recomendados=data.tecnicos_recomendados,
        condiciones_lugar=data.condiciones_lugar,
        observacion_tecnica=data.observacion_tecnica,
    )
    db.add(evaluation)
    try:
        db.flush()
        _replace_materials(db, evaluation, data.materiales)
        visit.estado = "En Proceso"
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_visit(db, id_visita)


def actualizar_evaluacion(
    db: Session,
    id_visita: int,
    data: EvaluacionVisitaDraft,
    current_employee_id: int,
) -> dict[str, Any] | None:
    visit = _locked_visit(db, id_visita)
    if visit is None:
        return None
    if visit.id_empleado != current_employee_id:
        raise VisitaNoAsignadaError
    if visit.estado != "En Proceso":
        raise EstadoVisitaError
    evaluation = db.scalar(
        select(EvaluacionVisita).where(EvaluacionVisita.id_visita == id_visita)
    )
    if evaluation is None:
        raise EvaluacionNotFoundError

    values = data.model_dump(exclude_unset=True, exclude={"materiales"})
    for field in (
        "descripcion_trabajo",
        "tecnicos_recomendados",
        "condiciones_lugar",
        "observacion_tecnica",
    ):
        if field in values:
            setattr(evaluation, field, values[field])
    if "materiales" in data.model_fields_set:
        _replace_materials(db, evaluation, data.materiales or [])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_visit(db, id_visita)


def finalizar_evaluacion(
    db: Session,
    id_visita: int,
    data: EvaluacionVisitaFinalizar,
    current_employee_id: int,
    current_user_id: int,
) -> dict[str, Any] | None:
    visit = _locked_visit(db, id_visita)
    if visit is None:
        return None
    if visit.id_empleado != current_employee_id:
        raise VisitaNoAsignadaError
    if visit.estado != "En Proceso":
        raise EstadoVisitaError
    evaluation = db.scalar(
        select(EvaluacionVisita).where(EvaluacionVisita.id_visita == id_visita)
    )
    if evaluation is None:
        raise EvaluacionNotFoundError

    try:
        evaluation.descripcion_trabajo = data.descripcion_trabajo
        evaluation.tecnicos_recomendados = data.tecnicos_recomendados
        evaluation.condiciones_lugar = data.condiciones_lugar
        evaluation.observacion_tecnica = data.observacion_tecnica
        _replace_materials(db, evaluation, data.materiales)
        visit.estado = "Completada"
        # El flush expone el estado y los materiales finales al snapshot de Cotizaciones.
        db.flush()
        create_cotizacion_evaluacion(
            db,
            CotizacionEvaluacionCreate(id_evaluacion=evaluation.id_evaluacion),
            creado_por=current_user_id,
            gestionar_transaccion=False,
        )
        db.commit()
    except (
        CotizacionClienteInactivoError,
        CotizacionConflictError,
        EvaluacionConflictError,
        EvaluacionNoFinalizadaError,
        CotizacionEvaluacionNotFoundError,
        MaterialEvaluacionInvalidoError,
    ) as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except IntegrityError as exc:
        db.rollback()
        raise VisitaConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_visit(db, id_visita)
