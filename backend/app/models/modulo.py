"""Modelo de módulos y tabla de relación con usuarios."""

# ==========================================
# IMPORTS
# ==========================================
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.usuario import Usuario


# ==========================================
# TABLA DE RELACION USUARIO-MODULO
# ==========================================
usuario_modulos = Table(
    "usuario_modulos",
    Base.metadata,
    Column("usuario_id", ForeignKey("usuarios.id", ondelete="CASCADE"), primary_key=True),
    Column("modulo_id", ForeignKey("modulos.id", ondelete="CASCADE"), primary_key=True),
)


# ==========================================
# MODELO DE MODULO
# ==========================================
class Modulo(Base):
    __tablename__ = "modulos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    codigo: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    usuarios: Mapped[list["Usuario"]] = relationship(
        secondary=usuario_modulos,
        back_populates="modulos",
    )
