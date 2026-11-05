"""Versionado y activación de la configuración de comprobantes."""

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.finanzas.models.comprobante_configuracion import (
    ConfiguracionComprobante,
)
from app.modules.finanzas.schemas.comprobante_configuracion import (
    ConfiguracionComprobanteCreate,
)


# Serializa la creación de versiones sin agregar restricciones al esquema.
_ADVISORY_LOCK_KEY = 724_103_992
ESTADO_ACTIVA = "Activa"
ESTADO_INACTIVA = "Inactiva"


class ConfiguracionComprobanteConflictError(Exception):
    """La configuración no pudo persistirse por un conflicto concurrente."""


def _response(configuracion: ConfiguracionComprobante) -> dict[str, Any]:
    """Expone únicamente los datos administrables del comprobante."""

    return {
        "id_configuracion": configuracion.id_configuracion,
        "version": configuracion.version,
        "nombre_comercial": configuracion.nombre_comercial,
        "descripcion_empresa": configuracion.descripcion_empresa,
        "direccion": configuracion.direccion,
        "telefono": configuracion.telefono,
        "mensaje_final": configuracion.mensaje_final,
        "nota_fiscal": configuracion.nota_fiscal,
        "estado": configuracion.estado,
        "fecha_creacion": configuracion.fecha_creacion,
        "fecha_publicacion": configuracion.fecha_publicacion,
    }


def get_active_configuration(db: Session) -> dict[str, Any] | None:
    """Obtiene la versión activa que consumen los comprobantes."""

    configuracion = db.scalar(
        select(ConfiguracionComprobante)
        .where(ConfiguracionComprobante.estado == ESTADO_ACTIVA)
        .order_by(ConfiguracionComprobante.version.desc())
        .limit(1)
    )
    return None if configuracion is None else _response(configuracion)


def get_latest_configuration(db: Session) -> dict[str, Any] | None:
    """Obtiene la última versión, activa o no, para consulta administrativa."""

    configuracion = db.scalar(
        select(ConfiguracionComprobante)
        .order_by(ConfiguracionComprobante.version.desc())
        .limit(1)
    )
    return None if configuracion is None else _response(configuracion)


def save_configuration(
    db: Session,
    data: ConfiguracionComprobanteCreate,
) -> dict[str, Any]:
    """Crea una versión nueva y la activa desactivando la anterior.

    La creación, desactivación y activación ocurren en una sola transacción.
    No se modifica ningún comprobante, pago ni PDF histórico.
    """

    try:
        db.execute(select(func.pg_advisory_xact_lock(_ADVISORY_LOCK_KEY)))
        latest = db.scalar(
            select(ConfiguracionComprobante)
            .order_by(ConfiguracionComprobante.version.desc())
            .limit(1)
        )
        # La versión anterior deja de ser la fuente de los comprobantes nuevos.
        db.execute(
            update(ConfiguracionComprobante)
            .where(ConfiguracionComprobante.estado == ESTADO_ACTIVA)
            .values(estado=ESTADO_INACTIVA)
        )
        configuracion = ConfiguracionComprobante(
            **data.model_dump(),
            version=1 if latest is None else latest.version + 1,
            estado=ESTADO_ACTIVA,
            fecha_publicacion=datetime.now(),
        )
        db.add(configuracion)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise ConfiguracionComprobanteConflictError from error
    except Exception:
        db.rollback()
        raise
    db.refresh(configuracion)
    return _response(configuracion)
