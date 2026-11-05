"""Modelo SQLAlchemy para los proveedores registrados en PostgreSQL."""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.modules.mapas.models.ubicacion import Municipio


class Proveedor(Base):
    """Proveedor comercial asociado a un municipio existente."""

    __tablename__ = "proveedores"

    id_proveedor: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    nit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contacto: Mapped[str | None] = mapped_column(String(150), nullable=True)
    telefono: Mapped[str | None] = mapped_column(String(20), nullable=True)
    correo: Mapped[str | None] = mapped_column(String(150), nullable=True)
    direccion: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_municipio: Mapped[int | None] = mapped_column(
        ForeignKey("municipios.id_municipio"), nullable=True
    )
    estado: Mapped[str | None] = mapped_column(
        String(20), nullable=True, server_default="Activo"
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    municipio: Mapped[Municipio | None] = relationship(lazy="joined")
