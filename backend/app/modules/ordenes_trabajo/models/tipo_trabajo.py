"""Modelo SQLAlchemy del catálogo de tipos de trabajo."""

from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.modules.ordenes_trabajo.models.orden_trabajo import OrdenTrabajo


class TipoTrabajo(Base):
    """Catálogo de trabajos registrables; no define permisos ni sustituye puestos."""

    __tablename__ = "tipos_trabajo"

    id_tipo_trabajo: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="Activo"
    )

    ordenes: Mapped[list["OrdenTrabajo"]] = relationship(back_populates="tipo_trabajo")