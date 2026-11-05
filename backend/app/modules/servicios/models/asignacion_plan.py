"""Modelo ORM de la asignación de planes a clientes."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.modules.clientes.models.cliente import Cliente
from app.modules.planes.models.plan import Plan


class ServicioAsignacionPlan(Base):
    """Conserva el precio contratado como una instantánea del plan asignado."""

    __tablename__ = "servicio_asignacion_planes"

    id_asignacion: Mapped[int] = mapped_column(
        Identity(always=True), primary_key=True
    )
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente", name="fk_asignacion_cliente"), nullable=False
    )
    id_plan: Mapped[int] = mapped_column(
        ForeignKey("planes.id", name="fk_asignacion_plan"), nullable=False
    )
    costo_mensual: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_inicio: Mapped[date] = mapped_column(Date, nullable=False)
    dia_vencimiento: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    fecha_actualizacion: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True
    )

    cliente: Mapped[Cliente] = relationship(lazy="joined")
    plan: Mapped[Plan] = relationship(lazy="joined")
