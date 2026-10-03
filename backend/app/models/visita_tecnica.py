"""Modelo SQLAlchemy para visitas tecnicas programadas."""

from datetime import date, time
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, ForeignKey, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.cliente import Cliente
from app.models.empleado import Empleado
from app.models.tipo_instalacion import TipoInstalacion

if TYPE_CHECKING:
    from app.models.evaluacion_visita import EvaluacionVisita
    from app.models.instalacion import Instalacion
    from app.models.ubicacion_cliente import UbicacionCliente


class VisitaTecnica(Base):
    __tablename__ = "visitas_tecnicas"
    __table_args__ = (
        CheckConstraint(
            "estado IN ('Programada', 'En Proceso', 'Completada')",
            name="ck_visitas_tecnicas_estado",
        ),
    )

    id_visita: Mapped[int] = mapped_column(primary_key=True)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente"), nullable=False
    )
    # Es nullable para permitir la primera visita de clientes sin propiedades registradas.
    id_ubicacion: Mapped[int | None] = mapped_column(
        ForeignKey("ubicaciones_cliente.id_ubicacion"), nullable=True
    )
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado"), nullable=False
    )
    id_tipo_instalacion: Mapped[int] = mapped_column(
        ForeignKey("tipos_instalacion.id_tipo_instalacion"), nullable=False
    )
    fecha_programada: Mapped[date] = mapped_column(Date, nullable=False)
    hora_programada: Mapped[time] = mapped_column(Time, nullable=False)
    motivo_visita: Mapped[str] = mapped_column(String(250), nullable=False)
    foto_referencia: Mapped[str | None] = mapped_column(String(500), nullable=True)
    indicaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Programada"
    )

    cliente: Mapped[Cliente] = relationship(back_populates="visitas_tecnicas", lazy="joined")
    ubicacion: Mapped["UbicacionCliente | None"] = relationship(lazy="joined")
    empleado: Mapped[Empleado] = relationship(back_populates="visitas_tecnicas", lazy="joined")
    tipo_instalacion: Mapped[TipoInstalacion] = relationship(
        back_populates="visitas", lazy="joined"
    )
    # No se configura delete cascade: las restricciones NO ACTION protegen el historial.
    evaluacion: Mapped["EvaluacionVisita | None"] = relationship(
        back_populates="visita", uselist=False, passive_deletes="all"
    )
    instalaciones: Mapped[list["Instalacion"]] = relationship(
        back_populates="visita", passive_deletes="all"
    )
