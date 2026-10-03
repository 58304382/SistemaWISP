"""Modelo SQLAlchemy para el catalogo de puestos de empleados."""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.empleado import Empleado


class PuestoEmpleado(Base):
    __tablename__ = "puestos_empleado"

    id_puesto: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    # Clasifica la funcion laboral; no concede acceso ni reemplaza los permisos
    # que pertenecen a la cuenta de usuario.
    tiene_funciones_sistema: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    empleados: Mapped[list["Empleado"]] = relationship(back_populates="puesto")
