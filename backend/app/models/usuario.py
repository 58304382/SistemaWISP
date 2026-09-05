"""Modelo de usuarios del sistema."""

# ==========================================
# IMPORTS
# ==========================================
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.modulo import Modulo, usuario_modulos
from app.models.rol import Rol


# ==========================================
# MODELO DE USUARIO
# ==========================================
class Usuario(Base):
    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String, nullable=False)
    apellido: Mapped[str] = mapped_column(String, nullable=False)
    username: Mapped[str] = mapped_column(String, nullable=False)
    # Se conserva para compatibilidad con registros históricos, pero ya no forma parte del flujo.
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    rol_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    rol: Mapped[Rol] = relationship(back_populates="usuarios")
    modulos: Mapped[list[Modulo]] = relationship(
        secondary=usuario_modulos,
        back_populates="usuarios",
        lazy="selectin",
    )
