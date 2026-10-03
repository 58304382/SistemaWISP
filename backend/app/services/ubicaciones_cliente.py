"""Business rules and persistence for customer locations."""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.cliente import Cliente
from app.models.ubicacion_cliente import UbicacionCliente
from app.schemas.ubicacion_cliente import (
    UbicacionClienteCreate,
    UbicacionClienteUpdate,
)
from app.services.image_uploads import (
    image_url,
    remove_image_file,
    safe_image_path,
    store_image,
)


IMAGE_DIRECTORY = "ubicaciones_clientes"
IMAGE_PREFIX = "ubicacion"
PROPERTY_NUMBER_CONSTRAINT = "uq_ubicaciones_cliente_cliente_numero_propiedad"
MAX_PROPERTY_NUMBER_ATTEMPTS = 2


class ClienteNotFoundError(Exception):
    """The customer referenced by a location does not exist."""


class UbicacionClienteConflictError(Exception):
    """The database rejected a customer location mutation."""


def _location_query():
    return select(UbicacionCliente).options(joinedload(UbicacionCliente.cliente))


def _response(location: UbicacionCliente) -> dict[str, Any]:
    return {
        "id_ubicacion": location.id_ubicacion,
        "id_cliente": location.id_cliente,
        "numero_propiedad": location.numero_propiedad,
        "nombre_cliente": f"{location.cliente.nombres} {location.cliente.apellidos}".strip(),
        "direccion": location.direccion,
        "latitud": location.latitud,
        "longitud": location.longitud,
        "foto_fachada": image_url(location.foto_fachada),
        "referencia": location.referencia,
        "observaciones": location.observaciones,
        "estado": location.estado,
        "fecha_registro": location.fecha_registro,
    }


def _validate_client(db: Session, id_cliente: int) -> None:
    if db.scalar(select(Cliente.id_cliente).where(Cliente.id_cliente == id_cliente)) is None:
        raise ClienteNotFoundError


def _lock_client(db: Session, id_cliente: int) -> None:
    """Serializa la numeración por cliente, incluso cuando aún no tiene propiedades."""

    client_id = db.scalar(
        select(Cliente.id_cliente)
        .where(Cliente.id_cliente == id_cliente)
        .with_for_update(of=Cliente)
    )
    if client_id is None:
        raise ClienteNotFoundError


def _next_property_number(db: Session, id_cliente: int) -> int:
    """Calcula el siguiente correlativo sin reutilizar huecos históricos."""

    return db.scalar(
        select(func.coalesce(func.max(UbicacionCliente.numero_propiedad), 0) + 1).where(
            UbicacionCliente.id_cliente == id_cliente
        )
    )


def _integrity_constraint_name(error: IntegrityError) -> str | None:
    diagnostics = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diagnostics, "constraint_name", None)


def create_ubicacion_cliente_in_transaction(
    db: Session,
    data: UbicacionClienteCreate,
    image_content: bytes | None = None,
) -> tuple[UbicacionCliente, Path | None]:
    """Crea y hace flush sin commit para permitir operaciones de negocio atómicas."""

    # El bloqueo del cliente conserva una única estrategia segura de numeración.
    _lock_client(db, data.id_cliente)
    location = UbicacionCliente(
        **data.model_dump(),
        numero_propiedad=_next_property_number(db, data.id_cliente),
    )
    db.add(location)
    # La PK y el UNIQUE deben resolverse antes de escribir la fotografía física.
    db.flush()
    saved_image: Path | None = None
    if image_content is not None:
        relative_path, saved_image = store_image(
            image_content, IMAGE_DIRECTORY, IMAGE_PREFIX, location.id_ubicacion
        )
        location.foto_fachada = relative_path
    return location, saved_image


def list_ubicaciones_cliente(db: Session, id_cliente: int) -> list[dict[str, Any]]:
    _validate_client(db, id_cliente)
    locations = db.scalars(
        _location_query()
        .where(UbicacionCliente.id_cliente == id_cliente)
        .order_by(UbicacionCliente.id_ubicacion)
    ).unique().all()
    return [_response(location) for location in locations]


def list_ubicaciones_mapa(db: Session) -> list[dict[str, Any]]:
    """Lista cada propiedad física una vez para el módulo principal Mapas."""

    locations = db.scalars(
        _location_query().order_by(
            UbicacionCliente.id_cliente,
            UbicacionCliente.numero_propiedad,
            UbicacionCliente.id_ubicacion,
        )
    ).unique().all()
    return [_response(location) for location in locations]


def get_ubicacion_cliente(
    db: Session, id_ubicacion: int
) -> dict[str, Any] | None:
    location = db.scalar(
        _location_query().where(UbicacionCliente.id_ubicacion == id_ubicacion)
    )
    return None if location is None else _response(location)


def get_ubicacion_cliente_model(
    db: Session, id_ubicacion: int
) -> UbicacionCliente | None:
    return db.scalar(
        _location_query().where(UbicacionCliente.id_ubicacion == id_ubicacion)
    )


def create_ubicacion_cliente(
    db: Session,
    data: UbicacionClienteCreate,
    image_content: bytes | None = None,
) -> dict[str, Any]:
    for attempt in range(MAX_PROPERTY_NUMBER_ATTEMPTS):
        saved_image: Path | None = None
        try:
            location, saved_image = create_ubicacion_cliente_in_transaction(
                db, data, image_content
            )
            db.commit()
        except IntegrityError as error:
            constraint_name = _integrity_constraint_name(error)
            db.rollback()
            if saved_image is not None:
                remove_image_file(saved_image)
            # Una carrera externa puede omitir el bloqueo; se recalcula una sola vez con otra instancia.
            if constraint_name == PROPERTY_NUMBER_CONSTRAINT and attempt == 0:
                continue
            raise UbicacionClienteConflictError from error
        except Exception:
            db.rollback()
            if saved_image is not None:
                remove_image_file(saved_image)
            raise

        response = get_ubicacion_cliente(db, location.id_ubicacion)
        if response is None:
            raise RuntimeError("La ubicación creada no pudo recuperarse")
        return response

    raise RuntimeError("No fue posible asignar el número de propiedad")


def update_ubicacion_cliente(
    db: Session,
    location: UbicacionCliente,
    data: UbicacionClienteUpdate,
) -> dict[str, Any]:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)

    for field in (
        "direccion",
        "latitud",
        "longitud",
        "referencia",
        "observaciones",
        "estado",
    ):
        if field in values:
            setattr(location, field, values[field])

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise UbicacionClienteConflictError from error
    except Exception:
        db.rollback()
        raise

    response = get_ubicacion_cliente(db, location.id_ubicacion)
    if response is None:
        raise RuntimeError("La ubicación actualizada no pudo recuperarse")
    return response


def replace_ubicacion_cliente_image(
    db: Session,
    location: UbicacionCliente,
    image_content: bytes,
) -> dict[str, Any]:
    old_relative_path = location.foto_fachada
    old_image = (
        None
        if old_relative_path is None
        else safe_image_path(old_relative_path, IMAGE_DIRECTORY)
    )
    relative_path, saved_image = store_image(
        image_content, IMAGE_DIRECTORY, IMAGE_PREFIX, location.id_ubicacion
    )
    location.foto_fachada = relative_path
    try:
        # Keep the old file until the database points at the new atomic upload.
        db.commit()
    except IntegrityError as error:
        db.rollback()
        remove_image_file(saved_image)
        raise UbicacionClienteConflictError from error
    except Exception:
        db.rollback()
        remove_image_file(saved_image)
        raise

    if old_image is not None and old_image != saved_image:
        try:
            remove_image_file(old_image)
        except Exception:
            # If old-file cleanup fails, restore the previous DB/file pair.
            location.foto_fachada = old_relative_path
            try:
                db.commit()
            except Exception:
                db.rollback()
                raise
            remove_image_file(saved_image)
            raise
    response = get_ubicacion_cliente(db, location.id_ubicacion)
    if response is None:
        raise RuntimeError("La ubicación actualizada no pudo recuperarse")
    return response


def remove_ubicacion_cliente_image(
    db: Session,
    location: UbicacionCliente,
) -> dict[str, Any]:
    old_relative_path = location.foto_fachada
    old_image = (
        None
        if old_relative_path is None
        else safe_image_path(old_relative_path, IMAGE_DIRECTORY)
    )
    location.foto_fachada = None
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise UbicacionClienteConflictError from error
    except Exception:
        db.rollback()
        raise

    if old_image is not None:
        try:
            remove_image_file(old_image)
        except Exception:
            # Restore the database reference when physical removal fails.
            location.foto_fachada = old_relative_path
            try:
                db.commit()
            except Exception:
                db.rollback()
            raise

    response = get_ubicacion_cliente(db, location.id_ubicacion)
    if response is None:
        raise RuntimeError("La ubicación actualizada no pudo recuperarse")
    return response
