"""Versionado y publicación de la configuración de documentos comerciales."""

from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.cotizaciones.models.cotizacion import ConfiguracionDocumentoComercial
from app.modules.cotizaciones.schemas.cotizacion import ConfiguracionDocumentoCreate
from app.services.image_uploads import image_url, remove_image_file, store_image


IMAGE_DIRECTORY = "documentos_comerciales"
IMAGE_PREFIX = "logo"
_ADVISORY_LOCK_KEY = 724_103_991


class ConfiguracionDocumentoConflictError(Exception):
    """La configuración cambió concurrentemente o no pudo persistirse."""


class ConfiguracionDocumentoNotFoundError(Exception):
    """La versión solicitada no existe."""


def _lock_versions(db: Session) -> None:
    """Serializa guardados/publicaciones sin agregar restricciones al esquema."""

    db.execute(select(func.pg_advisory_xact_lock(_ADVISORY_LOCK_KEY)))


def _response(configuracion: ConfiguracionDocumentoComercial) -> dict[str, Any]:
    return {
        "id_configuracion": configuracion.id_configuracion,
        "version": configuracion.version,
        "nombre_comercial": configuracion.nombre_comercial,
        "nit": configuracion.nit,
        "direccion": configuracion.direccion,
        "telefono": configuracion.telefono,
        "correo": configuracion.correo,
        "logo_url": image_url(configuracion.logo_ruta),
        "terminos_cotizacion": configuracion.terminos_cotizacion,
        "terminos_proforma": configuracion.terminos_proforma,
        "mensaje_final": configuracion.mensaje_final,
        "estado": configuracion.estado,
        "fecha_creacion": configuracion.fecha_creacion,
    }


def get_active_configuration(db: Session) -> dict[str, Any] | None:
    configuracion = db.scalar(
        select(ConfiguracionDocumentoComercial)
        .where(ConfiguracionDocumentoComercial.estado == "Activo")
        .order_by(ConfiguracionDocumentoComercial.version.desc())
        .limit(1)
    )
    return None if configuracion is None else _response(configuracion)


def get_latest_configuration(db: Session) -> dict[str, Any] | None:
    configuracion = db.scalar(
        select(ConfiguracionDocumentoComercial)
        .order_by(ConfiguracionDocumentoComercial.version.desc())
        .limit(1)
    )
    return None if configuracion is None else _response(configuracion)


def save_configuration(
    db: Session,
    data: ConfiguracionDocumentoCreate,
    image_content: bytes | None,
) -> dict[str, Any]:
    """Crea un borrador inmutable e hereda el logo si no se envía otro."""

    saved_image: Path | None = None
    try:
        _lock_versions(db)
        latest = db.scalar(
            select(ConfiguracionDocumentoComercial)
            .order_by(ConfiguracionDocumentoComercial.version.desc())
            .limit(1)
        )
        configuration = ConfiguracionDocumentoComercial(
            **data.model_dump(),
            version=1 if latest is None else latest.version + 1,
            logo_ruta=None if latest is None else latest.logo_ruta,
            estado="Borrador",
        )
        db.add(configuration)
        db.flush()
        if image_content is not None:
            configuration.logo_ruta, saved_image = store_image(
                image_content,
                IMAGE_DIRECTORY,
                IMAGE_PREFIX,
                configuration.id_configuracion,
            )
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise ConfiguracionDocumentoConflictError from error
    except Exception:
        db.rollback()
        if saved_image is not None:
            remove_image_file(saved_image)
        raise
    db.refresh(configuration)
    return _response(configuration)


def publish_configuration(db: Session, id_configuracion: int) -> dict[str, Any]:
    """Publica una versión y deja todas las demás inactivas atómicamente."""

    try:
        _lock_versions(db)
        configuration = db.get(ConfiguracionDocumentoComercial, id_configuracion)
        if configuration is None:
            raise ConfiguracionDocumentoNotFoundError
        db.execute(
            update(ConfiguracionDocumentoComercial)
            .where(ConfiguracionDocumentoComercial.id_configuracion != id_configuracion)
            .where(ConfiguracionDocumentoComercial.estado == "Activo")
            .values(estado="Inactivo")
        )
        configuration.estado = "Activo"
        db.commit()
    except ConfiguracionDocumentoNotFoundError:
        db.rollback()
        raise
    except IntegrityError as error:
        db.rollback()
        raise ConfiguracionDocumentoConflictError from error
    except Exception:
        db.rollback()
        raise
    db.refresh(configuration)
    return _response(configuration)
