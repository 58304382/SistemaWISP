"""Modelo SQLAlchemy para empleados."""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
# Registra el modelo existente para resolver Municipio.clientes al configurar mappers.
from app.models.cliente import Cliente  # noqa: F401
from app.models.puesto_empleado import PuestoEmpleado
from app.models.ubicacion import Municipio

if TYPE_CHECKING:
    from app.models.instalacion import InstalacionTecnico
    from app.models.usuario import Usuario
    from app.models.visita_tecnica import VisitaTecnica


class Empleado(Base):
    __tablename__ = "empleados"
    __table_args__ = (
        UniqueConstraint("id_usuario", name="uq_empleados_id_usuario"),
    )

    id_empleado: Mapped[int] = mapped_column(primary_key=True)
    # La unica FK fisica vive en empleados. La cuenta es opcional de forma
    # permanente porque no todos los puestos utilizan SistemaWISP.
    id_usuario: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", name="fk_empleados_usuario", ondelete="RESTRICT"),
        nullable=True,
    )
    id_puesto: Mapped[int] = mapped_column(
        ForeignKey("puestos_empleado.id_puesto"), nullable=False
    )
    id_municipio: Mapped[int] = mapped_column(
        ForeignKey("municipios.id_municipio"), nullable=False
    )
    codigo: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    nombres: Mapped[str] = mapped_column(String(150), nullable=False)
    apellidos: Mapped[str] = mapped_column(String(150), nullable=False)
    tipo_documento: Mapped[str] = mapped_column(String(30), nullable=False)
    numero_documento: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    telefono_principal: Mapped[str] = mapped_column(String(30), nullable=False)
    telefono_alternativo: Mapped[str | None] = mapped_column(String(30), nullable=True)
    correo: Mapped[str | None] = mapped_column(String(254), nullable=True)
    direccion: Mapped[str] = mapped_column(String(300), nullable=False)
    fecha_ingreso: Mapped[date] = mapped_column(Date, nullable=False)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    foto_perfil: Mapped[str | None] = mapped_column(String(500), nullable=True)

    puesto: Mapped[PuestoEmpleado] = relationship(back_populates="empleados", lazy="joined")
    municipio: Mapped[Municipio] = relationship(lazy="joined")
    usuario: Mapped["Usuario | None"] = relationship(
        back_populates="empleado", lazy="joined"
    )
    visitas_tecnicas: Mapped[list["VisitaTecnica"]] = relationship(
        back_populates="empleado", passive_deletes="all"
    )
    instalaciones_asignadas: Mapped[list["InstalacionTecnico"]] = relationship(
        back_populates="empleado", passive_deletes="all"
    )
