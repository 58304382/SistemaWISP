"""Modelo único para planes estándar y personalizados."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Plan(Base):
    __tablename__ = "planes"
    __table_args__ = (
        UniqueConstraint("nombre", name="uq_planes_nombre"),
        CheckConstraint(
            "tipo_plan IN ('ESTANDAR', 'PERSONALIZADO')",
            name="ck_planes_tipo_plan",
        ),
        CheckConstraint("precio_mensual > 0", name="ck_planes_precio_positivo"),
        CheckConstraint(
            "estado IN ('Activo', 'Inactivo')",
            name="ck_planes_estado",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), nullable=False)
    velocidad: Mapped[str] = mapped_column(String(30), nullable=False)
    precio_mensual: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    tipo_plan: Mapped[str] = mapped_column(String(20), nullable=False)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
