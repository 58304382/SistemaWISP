"""Modelo SQLAlchemy para el catalogo de tipos de instalacion."""

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.visita_tecnica import VisitaTecnica


class TipoInstalacion(Base):
    __tablename__ = "tipos_instalacion"
    __table_args__ = (
        CheckConstraint(
            "estado IN ('Activo', 'Inactivo')",
            name="ck_tipos_instalacion_estado",
        ),
    )

    id_tipo_instalacion: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    descripcion: Mapped[str | None] = mapped_column(String(250), nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )

    visitas: Mapped[list["VisitaTecnica"]] = relationship(
        back_populates="tipo_instalacion", passive_deletes="all"
    )
