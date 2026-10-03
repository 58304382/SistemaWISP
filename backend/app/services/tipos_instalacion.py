"""Consultas del catalogo existente de tipos de instalacion."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tipo_instalacion import TipoInstalacion


def list_tipos_instalacion_activos(db: Session) -> list[TipoInstalacion]:
    """Expone solo opciones activas para evitar programar trabajos con tipos inhabilitados."""

    return list(
        db.scalars(
            select(TipoInstalacion)
            .where(TipoInstalacion.estado == "Activo")
            .order_by(TipoInstalacion.nombre, TipoInstalacion.id_tipo_instalacion)
        ).all()
    )
