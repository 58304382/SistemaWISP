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
    from app.modules.clientes.models.cliente import Cliente
    from app.modules.ordenes_trabajo.models.orden_trabajo import EvaluacionOrden
    from app.modules.visitas_tecnicas.models.evaluacion_visita import EvaluacionVisita
    from app.modules.usuarios.models.usuario import Usuario


class Cotizacion(Base):
    """Cabecera comercial vinculada a un cliente directo, una evaluacion de
    visita o una evaluacion de orden de trabajo."""

    __tablename__ = "cotizaciones"
    __table_args__ = (
        UniqueConstraint("numero_cotizacion", name="uq_cotizaciones_numero"),
        UniqueConstraint("id_evaluacion", name="uq_cotizaciones_evaluacion"),
        UniqueConstraint(
            "id_evaluacion_orden", name="uq_cotizaciones_evaluacion_orden"
        ),
        CheckConstraint(
            "origen IN ('DIRECTA', 'EVALUACION', 'ORDEN_TRABAJO')",
            name="ck_cotizaciones_origen",
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
            "(origen = 'DIRECTA' AND id_evaluacion IS NULL "
            "AND id_evaluacion_orden IS NULL) OR "
            "(origen = 'EVALUACION' AND id_evaluacion IS NOT NULL "
            "AND id_evaluacion_orden IS NULL) OR "
            "(origen = 'ORDEN_TRABAJO' AND id_evaluacion IS NULL "
            "AND id_evaluacion_orden IS NOT NULL)",
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
    id_evaluacion_orden: Mapped[int | None] = mapped_column(
        ForeignKey(
            "evaluaciones_orden_trabajo.id_evaluacion", ondelete="RESTRICT"
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
    evaluacion_orden: Mapped["EvaluacionOrden | None"] = relationship(
        lazy="joined"
    )
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


class ConfiguracionDocumentoComercial(Base):
    """Versión de los datos institucionales usados en cotizaciones y proformas."""

    __tablename__ = "configuracion_documentos_comerciales"

    id_configuracion: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(nullable=False, unique=True)
    nombre_comercial: Mapped[str] = mapped_column(String(150), nullable=False)
    nit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    direccion: Mapped[str | None] = mapped_column(Text, nullable=True)
    telefono: Mapped[str | None] = mapped_column(String(25), nullable=True)
    correo: Mapped[str | None] = mapped_column(String(150), nullable=True)
    logo_ruta: Mapped[str | None] = mapped_column(String(500), nullable=True)
    terminos_cotizacion: Mapped[str | None] = mapped_column(Text, nullable=True)
    terminos_proforma: Mapped[str | None] = mapped_column(Text, nullable=True)
    mensaje_final: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
