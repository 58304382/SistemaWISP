"""Persistencia y manejo seguro de fotografías de antenas."""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.antena import Antena
from app.schemas.antena import AntenaCreate, AntenaUpdate
from app.services.image_uploads import (
    image_url,
    remove_image_file,
    safe_image_path,
    store_image,
)


IMAGE_DIRECTORY = "antenas"
IMAGE_PREFIX = "antena"


class AntenaConflictError(Exception):
    """La base de datos rechazó una modificación de antena."""


def _response(antenna: Antena) -> dict[str, Any]:
    return {
        "id_antena": antenna.id_antena,
        "nombre": antenna.nombre,
        "latitud": antenna.latitud,
        "longitud": antenna.longitud,
        "direccion_sector": antenna.direccion_sector,
        "referencia": antenna.referencia,
        "foto_antena": image_url(antenna.foto_antena),
        "estado": antenna.estado,
    }


def list_antenas(db: Session) -> list[dict[str, Any]]:
    antennas = db.scalars(select(Antena).order_by(Antena.nombre, Antena.id_antena)).all()
    return [_response(antenna) for antenna in antennas]


def get_antena_model(db: Session, id_antena: int) -> Antena | None:
    return db.get(Antena, id_antena)


def get_antena(db: Session, id_antena: int) -> dict[str, Any] | None:
    antenna = get_antena_model(db, id_antena)
    return None if antenna is None else _response(antenna)


def _committed_response(db: Session, id_antena: int) -> dict[str, Any]:
    response = get_antena(db, id_antena)
    if response is None:
        raise RuntimeError("La antena guardada no pudo recuperarse")
    return response


def create_antena(
    db: Session,
    data: AntenaCreate,
    image_content: bytes | None = None,
) -> dict[str, Any]:
    saved_image: Path | None = None
    try:
        antenna = Antena(**data.model_dump())
        db.add(antenna)
        # La identidad debe existir antes de generar el nombre físico de la imagen.
        db.flush()
        if image_content is not None:
            relative_path, saved_image = store_image(
                image_content, IMAGE_DIRECTORY, IMAGE_PREFIX, antenna.id_antena
            )
            antenna.foto_antena = relative_path
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise AntenaConflictError from error
    except Exception:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise
    return _committed_response(db, antenna.id_antena)


def update_antena(
    db: Session,
    antenna: Antena,
    data: AntenaUpdate,
) -> dict[str, Any]:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    for field in (
        "nombre",
        "latitud",
        "longitud",
        "direccion_sector",
        "referencia",
        "estado",
    ):
        if field in values:
            setattr(antenna, field, values[field])
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise AntenaConflictError from error
    except Exception:
        db.rollback()
        raise
    return _committed_response(db, antenna.id_antena)


def replace_antena_image(
    db: Session,
    antenna: Antena,
    image_content: bytes,
) -> dict[str, Any]:
    old_relative_path = antenna.foto_antena
    old_image = (
        None
        if old_relative_path is None
        else safe_image_path(old_relative_path, IMAGE_DIRECTORY)
    )
    relative_path, saved_image = store_image(
        image_content, IMAGE_DIRECTORY, IMAGE_PREFIX, antenna.id_antena
    )
    antenna.foto_antena = relative_path
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        remove_image_file(saved_image)
        raise AntenaConflictError from error
    except Exception:
        db.rollback()
        remove_image_file(saved_image)
        raise

    if old_image is not None and old_image != saved_image:
        try:
            remove_image_file(old_image)
        except Exception:
            # Mantiene una pareja DB/archivo consistente si falla la limpieza física.
            antenna.foto_antena = old_relative_path
            try:
                db.commit()
            except Exception:
                db.rollback()
                raise
            remove_image_file(saved_image)
            raise
    return _committed_response(db, antenna.id_antena)


def remove_antena_image(db: Session, antenna: Antena) -> dict[str, Any]:
    old_relative_path = antenna.foto_antena
    old_image = (
        None
        if old_relative_path is None
        else safe_image_path(old_relative_path, IMAGE_DIRECTORY)
    )
    antenna.foto_antena = None
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise AntenaConflictError from error
    except Exception:
        db.rollback()
        raise

    if old_image is not None:
        try:
            remove_image_file(old_image)
        except Exception:
            antenna.foto_antena = old_relative_path
            try:
                db.commit()
            except Exception:
                db.rollback()
            raise
    return _committed_response(db, antenna.id_antena)
