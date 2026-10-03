"""Modelos SQLAlchemy para cotizaciones, detalles y proformas existentes."""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.cliente import Cliente
    from app.models.evaluacion_visita import EvaluacionVisita
    from app.models.usuario import Usuario


class Cotizacion(Base):
    """Cabecera comercial vinculada a un cliente directo o una evaluacion."""

    __tablename__ = "cotizaciones"
    __table_args__ = (
        UniqueConstraint("numero_cotizacion", name="uq_cotizaciones_numero"),
        UniqueConstraint("id_evaluacion", name="uq_cotizaciones_evaluacion"),
        CheckConstraint(
            "origen IN ('DIRECTA', 'EVALUACION')", name="ck_cotizaciones_origen"
        ),
        CheckConstraint(
            "estado IN ('EN PROCESO', 'GENERADA', 'ACEPTADA', "
            "'RECHAZADA', 'COMPLETADA')",
            name="ck_cotizaciones_estado",
        ),
        CheckConstraint(
            "porcentaje_descuento >= 0 AND porcentaje_descuento <= 100",
            name="ck_cotizaciones_descuento",
        ),
        CheckConstraint(
            "(origen = 'DIRECTA' AND id_evaluacion IS NULL) OR "
            "(origen = 'EVALUACION' AND id_evaluacion IS NOT NULL)",
            name="ck_cotizaciones_origen_evaluacion",
        ),
    )

    id_cotizacion: Mapped[int] = mapped_column(primary_key=True)
    numero_cotizacion: Mapped[str] = mapped_column(String(20), nullable=False)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente", ondelete="RESTRICT"), nullable=False
    )
    id_evaluacion: Mapped[int | None] = mapped_column(
        ForeignKey(
            "evaluaciones_visita_tecnica.id_evaluacion", ondelete="RESTRICT"
        ),
        nullable=True,
    )
    origen: Mapped[str] = mapped_column(String(20), nullable=False)
    fecha: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    porcentaje_descuento: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0.00"
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(String(20), nullable=False)
    creado_por: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="RESTRICT"), nullable=False
    )
    fecha_actualizacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )

    cliente: Mapped["Cliente"] = relationship(lazy="joined")
    evaluacion: Mapped["EvaluacionVisita | None"] = relationship(lazy="joined")
    creador: Mapped["Usuario"] = relationship(lazy="joined")
    detalles: Mapped[list["CotizacionDetalle"]] = relationship(
        back_populates="cotizacion",
        order_by="CotizacionDetalle.id_detalle",
        lazy="selectin",
        passive_deletes=True,
    )
    proforma: Mapped["Proforma | None"] = relationship(
        back_populates="cotizacion",
        uselist=False,
        lazy="joined",
        passive_deletes="all",
    )


class CotizacionDetalle(Base):
    """Snapshot economico sin relacion con productos o inventario."""

    __tablename__ = "cotizacion_detalles"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_cotizacion_detalles_cantidad"),
        CheckConstraint(
            "precio_unitario IS NULL OR precio_unitario >= 0",
            name="ck_cotizacion_detalles_precio",
        ),
    )

    id_detalle: Mapped[int] = mapped_column(primary_key=True)
    id_cotizacion: Mapped[int] = mapped_column(
        ForeignKey("cotizaciones.id_cotizacion", ondelete="CASCADE"),
        nullable=False,
    )
    descripcion: Mapped[str] = mapped_column(String(200), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unidad: Mapped[str | None] = mapped_column(String(20), nullable=True)
    precio_unitario: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    cotizacion: Mapped[Cotizacion] = relationship(back_populates="detalles")


class Proforma(Base):
    """Referencia unica a una cotizacion aceptada, sin duplicar sus datos."""

    __tablename__ = "proformas"
    __table_args__ = (
        UniqueConstraint("id_cotizacion", name="uq_proformas_cotizacion"),
    )

    id_proforma: Mapped[int] = mapped_column(primary_key=True)
    id_cotizacion: Mapped[int] = mapped_column(
        ForeignKey("cotizaciones.id_cotizacion", ondelete="RESTRICT"),
        nullable=False,
    )
    fecha_generacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )

    cotizacion: Mapped[Cotizacion] = relationship(back_populates="proforma")
