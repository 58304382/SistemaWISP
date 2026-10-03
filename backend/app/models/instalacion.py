"""Modelos SQLAlchemy sobre el esquema real de instalaciones."""

from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.cliente import Cliente
from app.models.empleado import Empleado
from app.models.evaluacion_visita import EvaluacionVisita  # noqa: F401
from app.models.ubicacion_cliente import UbicacionCliente
from app.models.visita_tecnica import VisitaTecnica


class Instalacion(Base):
    __tablename__ = "instalaciones"
    __table_args__ = (
        CheckConstraint(
            "estado IN ('Programada', 'En Proceso', 'Completada')",
            name="ck_instalaciones_estado",
        ),
    )

    id_instalacion: Mapped[int] = mapped_column(primary_key=True)
    id_cliente: Mapped[int] = mapped_column(ForeignKey("clientes.id_cliente"), nullable=False)
    id_visita: Mapped[int | None] = mapped_column(
        ForeignKey("visitas_tecnicas.id_visita"), nullable=True
    )
    id_ubicacion: Mapped[int | None] = mapped_column(
        ForeignKey("ubicaciones_cliente.id_ubicacion"), nullable=True
    )
    fecha_programada: Mapped[date] = mapped_column(Date, nullable=False)
    hora_programada: Mapped[time] = mapped_column(Time, nullable=False)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, server_default="Programada")
    observaciones_tecnicas: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_finalizacion: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    evidencia_fotografica: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fecha_registro: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    cliente: Mapped[Cliente] = relationship(back_populates="instalaciones", lazy="joined")
    visita: Mapped[VisitaTecnica | None] = relationship(
        back_populates="instalaciones", lazy="joined"
    )
    ubicacion: Mapped[UbicacionCliente | None] = relationship(
        back_populates="instalaciones", lazy="joined"
    )
    asignaciones: Mapped[list["InstalacionTecnico"]] = relationship(
        back_populates="instalacion", lazy="selectin"
    )


class InstalacionTecnico(Base):
    __tablename__ = "instalacion_tecnicos"
    __table_args__ = (
        UniqueConstraint(
            "id_instalacion",
            "id_empleado",
            name="uq_instalacion_tecnico",
        ),
        Index(
            "uq_instalacion_un_encargado",
            "id_instalacion",
            unique=True,
            postgresql_where=text("es_encargado = true"),
        ),
    )

    id_instalacion_tecnico: Mapped[int] = mapped_column(primary_key=True)
    id_instalacion: Mapped[int] = mapped_column(
        ForeignKey("instalaciones.id_instalacion"), nullable=False
    )
    id_empleado: Mapped[int] = mapped_column(ForeignKey("empleados.id_empleado"), nullable=False)
    es_encargado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    instalacion: Mapped[Instalacion] = relationship(back_populates="asignaciones")
    empleado: Mapped[Empleado] = relationship(
        back_populates="instalaciones_asignadas", lazy="joined"
    )
