"""Modelos SQLAlchemy para departamentos y municipios."""

# ==========================================
# IMPORTS Y REFERENCIAS DE RELACIONES
# ==========================================
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.cliente import Cliente


# ==========================================
# DEPARTAMENTO Y MUNICIPIO
# ==========================================
class Departamento(Base):
    """Catalogo de departamentos disponibles para los clientes."""

    __tablename__ = "departamentos"

    id_departamento: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    codigo: Mapped[str | None] = mapped_column(String(20), nullable=True)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="Activo")

    municipios: Mapped[list["Municipio"]] = relationship(
        back_populates="departamento",
        lazy="selectin",
    )


class Municipio(Base):
    """Catalogo de municipios relacionados con un departamento."""

    __tablename__ = "municipios"

    id_municipio: Mapped[int] = mapped_column(primary_key=True)
    id_departamento: Mapped[int] = mapped_column(
        ForeignKey("departamentos.id_departamento"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    codigo_postal: Mapped[str | None] = mapped_column(String(10), nullable=True)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="Activo")

    departamento: Mapped[Departamento] = relationship(back_populates="municipios")
    clientes: Mapped[list["Cliente"]] = relationship(back_populates="municipio")
