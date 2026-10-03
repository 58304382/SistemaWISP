"""Consultas y reglas transaccionales del modulo de instalaciones."""

from collections.abc import Mapping
from datetime import datetime
import logging
from pathlib import Path
from typing import Any
import unicodedata

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.cliente import Cliente
from app.models.empleado import Empleado
from app.models.instalacion import (
    Instalacion,
    InstalacionTecnico,
)
from app.models.puesto_empleado import PuestoEmpleado
from app.models.ubicacion_cliente import UbicacionCliente
from app.models.ubicacion import Municipio
from app.models.visita_tecnica import VisitaTecnica
from app.schemas.instalacion import (
    EquipoTecnicoUpdate,
    InstalacionCreate,
    InstalacionUpdate,
    TecnicoAsignacion,
)
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    image_url,
    remove_image_file,
    safe_image_path,
    store_image,
)


logger = logging.getLogger(__name__)


class ClienteNotFoundError(Exception):
    pass


class ClienteInactivoError(Exception):
    pass


class VisitaNotFoundError(Exception):
    pass


class VisitaInvalidaError(Exception):
    pass


class UbicacionNotFoundError(Exception):
    pass


class UbicacionInvalidaError(Exception):
    pass


class EmpleadoNotFoundError(Exception):
    pass


class EmpleadoInactivoError(Exception):
    pass


class EmpleadoSinPuestoTecnicoError(Exception):
    pass


class EstadoInstalacionError(Exception):
    pass


class TecnicoNoAsignadoError(Exception):
    pass


class InstalacionConflictError(Exception):
    pass


def _installation_query():
    return (
        select(Instalacion)
        .options(joinedload(Instalacion.cliente).joinedload(Cliente.municipio))
        .options(
            joinedload(Instalacion.visita).joinedload(VisitaTecnica.tipo_instalacion)
        )
        .options(joinedload(Instalacion.visita).joinedload(VisitaTecnica.evaluacion))
        .options(joinedload(Instalacion.ubicacion))
        .options(
            selectinload(Instalacion.asignaciones)
            .joinedload(InstalacionTecnico.empleado)
            .joinedload(Empleado.puesto)
        )
    )


def _technician_response(assignment: InstalacionTecnico) -> dict[str, Any]:
    employee = assignment.empleado
    return {
        "id_empleado": employee.id_empleado,
        "codigo": employee.codigo,
        "nombres": employee.nombres,
        "apellidos": employee.apellidos,
        "id_puesto": employee.id_puesto,
        "nombre_puesto": employee.puesto.nombre,
        "estado": employee.estado,
        "es_encargado": assignment.es_encargado,
    }


def _installation_response(installation: Instalacion) -> dict[str, Any]:
    client = installation.cliente
    technicians = sorted(
        (_technician_response(item) for item in installation.asignaciones),
        key=lambda item: (not item["es_encargado"], item["apellidos"], item["nombres"]),
    )
    lead = next((item for item in technicians if item["es_encargado"]), None)
    if lead is None:
        raise RuntimeError("La instalacion no tiene un tecnico encargado")

    visit = installation.visita
    location = installation.ubicacion
    return {
        "id_instalacion": installation.id_instalacion,
        "id_cliente": installation.id_cliente,
        "id_visita": installation.id_visita,
        "id_ubicacion": installation.id_ubicacion,
        "fecha_programada": installation.fecha_programada,
        "hora_programada": installation.hora_programada,
        "observaciones": installation.observaciones,
        "estado": installation.estado,
        "observaciones_tecnicas": installation.observaciones_tecnicas,
        "fecha_finalizacion": installation.fecha_finalizacion,
        "evidencia_fotografica": image_url(installation.evidencia_fotografica),
        "fecha_registro": installation.fecha_registro,
        "cliente": {
            "id_cliente": client.id_cliente,
            "nombre": f"{client.nombres} {client.apellidos}".strip(),
            "telefono": client.telefono,
            "direccion": client.direccion,
            "municipio": client.municipio.nombre,
        },
        "visita": None
        if visit is None
        else {
            "id_visita": visit.id_visita,
            "id_tipo_instalacion": visit.id_tipo_instalacion,
            "tipo_instalacion": visit.tipo_instalacion.nombre,
            "descripcion_evaluacion": (
                None if visit.evaluacion is None else visit.evaluacion.descripcion_trabajo
            ),
        },
        "ubicacion": None
        if location is None
        else {
            "id_ubicacion": location.id_ubicacion,
            "direccion": location.direccion,
            "latitud": location.latitud,
            "longitud": location.longitud,
            "referencia": location.referencia,
            "observaciones": location.observaciones,
        },
        "tecnicos": technicians,
        # El encargado es la misma representacion ya incluida en tecnicos, no otra fila fisica.
        "encargado": lead,
    }


def _normalize_position_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    ).casefold().strip()


def list_tecnicos_activos(db: Session) -> list[dict[str, Any]]:
    employees = db.scalars(
        select(Empleado)
        .join(Empleado.puesto)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.estado == "Activo", PuestoEmpleado.estado == "Activo")
        .order_by(Empleado.apellidos, Empleado.nombres, Empleado.id_empleado)
    ).unique().all()
    return [
        {
            "id_empleado": employee.id_empleado,
            "codigo": employee.codigo,
            "nombres": employee.nombres,
            "apellidos": employee.apellidos,
            "id_puesto": employee.id_puesto,
            "nombre_puesto": employee.puesto.nombre,
            "estado": employee.estado,
            "es_encargado": False,
        }
        for employee in employees
        if _normalize_position_name(employee.puesto.nombre) == "tecnico"
    ]


def list_instalaciones(db: Session, estado: str | None = None) -> list[dict[str, Any]]:
    query = _installation_query()
    if estado is not None:
        query = query.where(Instalacion.estado == estado)
    installations = db.scalars(
        query.order_by(
            Instalacion.fecha_programada,
            Instalacion.hora_programada,
            Instalacion.id_instalacion,
        )
    ).unique().all()
    return [_installation_response(item) for item in installations]


def get_instalacion_model(db: Session, id_instalacion: int) -> Instalacion | None:
    return db.scalar(
        _installation_query().where(Instalacion.id_instalacion == id_instalacion)
    )


def get_instalacion(db: Session, id_instalacion: int) -> dict[str, Any] | None:
    installation = get_instalacion_model(db, id_instalacion)
    return None if installation is None else _installation_response(installation)


def _get_active_client(db: Session, id_cliente: int) -> Cliente:
    client = db.scalar(select(Cliente).where(Cliente.id_cliente == id_cliente))
    if client is None:
        raise ClienteNotFoundError
    if client.estado != "Activo":
        raise ClienteInactivoError
    return client


def _validate_visit(db: Session, id_visita: int | None, id_cliente: int) -> None:
    if id_visita is None:
        return
    visit = db.get(VisitaTecnica, id_visita)
    if visit is None:
        raise VisitaNotFoundError
    if visit.id_cliente != id_cliente or visit.estado != "Completada":
        raise VisitaInvalidaError


def _validate_location(db: Session, id_ubicacion: int | None, id_cliente: int) -> None:
    if id_ubicacion is None:
        return
    location = db.get(UbicacionCliente, id_ubicacion)
    if location is None:
        raise UbicacionNotFoundError
    if location.id_cliente != id_cliente or location.estado != "Activo":
        raise UbicacionInvalidaError


def _get_active_technician(db: Session, id_empleado: int) -> Empleado:
    employee = db.scalar(
        select(Empleado)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.id_empleado == id_empleado)
    )
    if employee is None:
        raise EmpleadoNotFoundError
    if employee.estado != "Activo":
        raise EmpleadoInactivoError
    if employee.puesto.estado != "Activo" or _normalize_position_name(employee.puesto.nombre) != "tecnico":
        raise EmpleadoSinPuestoTecnicoError
    return employee


def _build_assignments(
    db: Session, technicians: list[TecnicoAsignacion]
) -> list[InstalacionTecnico]:
    assignments = []
    for technician in technicians:
        _get_active_technician(db, technician.id_empleado)
        assignments.append(
            InstalacionTecnico(
                id_empleado=technician.id_empleado,
                es_encargado=technician.es_encargado,
            )
        )
    return assignments


def _replace_assignments(
    db: Session,
    installation: Instalacion,
    technicians: list[TecnicoAsignacion],
) -> None:
    for technician in technicians:
        _get_active_technician(db, technician.id_empleado)

    existing = {item.id_empleado: item for item in installation.asignaciones}
    requested_ids = {item.id_empleado for item in technicians}

    # Primero libera el indice unico parcial del encargado; luego aplica el equipo completo.
    for assignment in existing.values():
        assignment.es_encargado = False
    db.flush()

    for id_empleado, assignment in existing.items():
        if id_empleado not in requested_ids:
            db.delete(assignment)
    for technician in technicians:
        assignment = existing.get(technician.id_empleado)
        if assignment is None:
            assignment = InstalacionTecnico(id_empleado=technician.id_empleado)
            installation.asignaciones.append(assignment)
        assignment.es_encargado = technician.es_encargado


def _require_programada(installation: Instalacion) -> None:
    if installation.estado != "Programada":
        raise EstadoInstalacionError


def _lock_installation(db: Session, installation: Instalacion) -> Instalacion:
    locked = db.scalar(
        select(Instalacion)
        .where(Instalacion.id_instalacion == installation.id_instalacion)
        # Las relaciones opcionales usan OUTER JOIN por defecto; solo se bloquea la fila base.
        .with_for_update(of=Instalacion)
        .execution_options(populate_existing=True)
    )
    if locked is None:
        raise InstalacionConflictError
    # La coleccion pudo cargarse antes de esperar el bloqueo; se relee para evitar equipos obsoletos.
    db.refresh(locked, attribute_names=["asignaciones"])
    return locked


def _committed_response(db: Session, id_instalacion: int) -> dict[str, Any]:
    response = get_instalacion(db, id_instalacion)
    if response is None:
        raise RuntimeError("La instalacion guardada no pudo recuperarse")
    return response


def create_instalacion(db: Session, data: InstalacionCreate) -> dict[str, Any]:
    try:
        _get_active_client(db, data.id_cliente)
        _validate_visit(db, data.id_visita, data.id_cliente)
        _validate_location(db, data.id_ubicacion, data.id_cliente)
        assignments = _build_assignments(db, data.tecnicos)
        installation = Instalacion(
            id_cliente=data.id_cliente,
            id_visita=data.id_visita,
            id_ubicacion=data.id_ubicacion,
            fecha_programada=data.fecha_programada,
            hora_programada=data.hora_programada,
            observaciones=data.observaciones,
            estado="Programada",
            asignaciones=assignments,
        )
        db.add(installation)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise InstalacionConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, installation.id_instalacion)


def update_instalacion(
    db: Session, installation: Instalacion, data: InstalacionUpdate
) -> dict[str, Any]:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    try:
        installation = _lock_installation(db, installation)
        _require_programada(installation)
        id_cliente = values.get("id_cliente", installation.id_cliente)
        id_visita = values.get("id_visita", installation.id_visita)
        id_ubicacion = values.get("id_ubicacion", installation.id_ubicacion)
        _get_active_client(db, id_cliente)
        _validate_visit(db, id_visita, id_cliente)
        _validate_location(db, id_ubicacion, id_cliente)
        if data.tecnicos is not None:
            _replace_assignments(db, installation, data.tecnicos)
        for field in (
            "id_cliente",
            "id_visita",
            "id_ubicacion",
            "fecha_programada",
            "hora_programada",
            "observaciones",
        ):
            if field in values:
                setattr(installation, field, values[field])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise InstalacionConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, installation.id_instalacion)


def replace_tecnicos(
    db: Session, installation: Instalacion, data: EquipoTecnicoUpdate
) -> dict[str, Any]:
    try:
        installation = _lock_installation(db, installation)
        _require_programada(installation)
        _replace_assignments(db, installation, data.tecnicos)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise InstalacionConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, installation.id_instalacion)


def set_encargado(
    db: Session, installation: Instalacion, id_empleado: int
) -> dict[str, Any]:
    try:
        installation = _lock_installation(db, installation)
        _require_programada(installation)
        assignment = next(
            (item for item in installation.asignaciones if item.id_empleado == id_empleado),
            None,
        )
        if assignment is None:
            raise TecnicoNoAsignadoError
        # El flush intermedio evita violar el indice unico parcial de PostgreSQL.
        for item in installation.asignaciones:
            item.es_encargado = False
        db.flush()
        assignment.es_encargado = True
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise InstalacionConflictError from exc
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, installation.id_instalacion)


def iniciar_instalacion(db: Session, installation: Instalacion) -> dict[str, Any]:
    try:
        installation = _lock_installation(db, installation)
        _require_programada(installation)
        installation.estado = "En Proceso"
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, installation.id_instalacion)


def completar_instalacion(
    db: Session,
    installation: Instalacion,
    observaciones_tecnicas: str,
    image_content: bytes,
) -> dict[str, Any]:
    observations = observaciones_tecnicas.strip()
    if not observations:
        raise ValueError("Las observaciones tecnicas son obligatorias")

    saved_path: Path | None = None
    old_path: Path | None = None
    try:
        installation = _lock_installation(db, installation)
        if installation.estado != "En Proceso":
            raise EstadoInstalacionError
        if installation.evidencia_fotografica is not None:
            old_path = safe_image_path(
                installation.evidencia_fotografica, "evidencias_instalacion"
            )
        relative_path, saved_path = store_image(
            image_content,
            "evidencias_instalacion",
            "instalacion",
            installation.id_instalacion,
        )
        installation.observaciones_tecnicas = observations
        installation.evidencia_fotografica = relative_path
        installation.fecha_finalizacion = datetime.now()
        installation.estado = "Completada"
        db.commit()
    except Exception:
        db.rollback()
        if saved_path is not None:
            remove_image_file(saved_path)
        raise
    if old_path is not None and old_path != saved_path:
        try:
            remove_image_file(old_path)
        except (ImagePathError, ImageStorageError):
            logger.warning(
                "No se pudo eliminar la evidencia anterior de la instalacion",
                exc_info=True,
            )
    return _committed_response(db, installation.id_instalacion)


def delete_instalacion(db: Session, installation: Instalacion) -> dict[str, Any]:
    evidence_path: Path | None = None
    try:
        installation = _lock_installation(db, installation)
        _require_programada(installation)
        response = _installation_response(installation)
        if installation.evidencia_fotografica is not None:
            evidence_path = safe_image_path(
                installation.evidencia_fotografica, "evidencias_instalacion"
            )
        # La FK no tiene cascade: las filas del equipo deben eliminarse expresamente.
        db.execute(
            delete(InstalacionTecnico).where(
                InstalacionTecnico.id_instalacion == installation.id_instalacion
            )
        )
        db.flush()
        db.delete(installation)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise InstalacionConflictError from exc
    except Exception:
        db.rollback()
        raise
    if evidence_path is not None:
        try:
            remove_image_file(evidence_path)
        except (ImagePathError, ImageStorageError):
            logger.warning(
                "No se pudo eliminar la evidencia de la instalacion borrada",
                exc_info=True,
            )
    return response
