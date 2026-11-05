"""Metadata estructural de Caja; FastAPI valida estados, montos y operaciones."""

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Numeric,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.modules.empleados.models.empleado import Empleado
    from app.modules.finanzas.models.cobros import MetodoPago, Pago


class CategoriaCaja(Base):
    """Catalogo de categorias utilizadas por los movimientos de caja."""

    __tablename__ = "categorias_caja"
    __table_args__ = (
        UniqueConstraint(
            "id_categoria",
            "origen_financiero",
            name="uq_categorias_caja_id_origen",
        ),
        Index(
            "uq_categorias_caja_origen_automatico",
            "origen_financiero",
            unique=True,
            postgresql_where=text("origen_financiero IS NOT NULL"),
        ),
    )

    id_categoria: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(Text, nullable=False)
    origen_financiero: Mapped[str | None] = mapped_column(Text, nullable=True)

    movimientos: Mapped[list["MovimientoCaja"]] = relationship(
        primaryjoin="CategoriaCaja.id_categoria == MovimientoCaja.id_categoria",
        foreign_keys="[MovimientoCaja.id_categoria]",
        back_populates="categoria",
    )


class SesionCaja(Base):
    """Apertura y cierre de caja a cargo de un empleado."""

    __tablename__ = "sesiones_caja"

    id_sesion: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_sesiones_caja_empleado"),
        nullable=False,
    )
    fecha_apertura: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    fecha_cierre: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    saldo_inicial: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    saldo_final: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    estado: Mapped[str] = mapped_column(Text, nullable=False)

    empleado: Mapped["Empleado"] = relationship()
    movimientos: Mapped[list["MovimientoCaja"]] = relationship(back_populates="sesion")
    arqueos: Mapped[list["ArqueoCaja"]] = relationship(back_populates="sesion")
    entregas: Mapped[list["EntregaCobrador"]] = relationship(back_populates="sesion")


class MovimientoCaja(Base):
    """Ingreso o egreso registrado dentro de una sesion de caja."""

    __tablename__ = "movimientos_caja"
    __table_args__ = (
        ForeignKeyConstraint(
            ["id_categoria", "origen_financiero"],
            ["categorias_caja.id_categoria", "categorias_caja.origen_financiero"],
            name="fk_movimientos_categoria_origen",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "id_movimiento",
            "id_metodo_pago",
            "monto",
            "origen_financiero",
            name="uq_movimientos_pago_integridad",
        ),
        Index(
            "ix_movimientos_caja_sesion_fecha",
            "id_sesion",
            text("fecha_hora DESC"),
        ),
        Index("ix_movimientos_caja_categoria", "id_categoria"),
        Index(
            "ix_movimientos_caja_metodo",
            "id_metodo_pago",
            postgresql_where=text("id_metodo_pago IS NOT NULL"),
        ),
    )

    id_movimiento: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_sesion: Mapped[int] = mapped_column(
        ForeignKey("sesiones_caja.id_sesion", name="fk_movimientos_sesion"),
        nullable=False,
    )
    id_categoria: Mapped[int] = mapped_column(
        ForeignKey("categorias_caja.id_categoria", name="fk_movimientos_categoria"),
        nullable=False,
    )
    id_metodo_pago: Mapped[int | None] = mapped_column(
        ForeignKey("metodos_pago.id_metodo_pago", name="fk_movimientos_metodo"),
        nullable=True,
    )
    id_responsable: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_movimientos_responsable"),
        nullable=False,
    )
    # FK ya existente: asocia egresos autorizados a la entrega, nunca a un ingreso nuevo.
    id_entrega_cobrador: Mapped[int | None] = mapped_column(
        ForeignKey("entregas_cobradores.id_entrega", name="fk_movimientos_entrega_cobrador"), nullable=True
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    origen_financiero: Mapped[str | None] = mapped_column(Text, nullable=True)
    concepto: Mapped[str] = mapped_column(Text, nullable=False)
    monto: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    referencia: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PostgreSQL conserva el identificador, pero no define una FK para asociarlo.
    id_salida_producto: Mapped[int | None] = mapped_column(nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )

    sesion: Mapped[SesionCaja] = relationship(back_populates="movimientos")
    categoria: Mapped[CategoriaCaja] = relationship(
        primaryjoin="CategoriaCaja.id_categoria == MovimientoCaja.id_categoria",
        foreign_keys=[id_categoria],
        back_populates="movimientos",
    )
    metodo_pago: Mapped["MetodoPago | None"] = relationship(
        back_populates="movimientos_caja"
    )
    responsable: Mapped["Empleado"] = relationship()
    pago: Mapped["Pago | None"] = relationship(
        primaryjoin=(
            "and_(MovimientoCaja.id_movimiento == Pago.id_movimiento_caja, "
            "MovimientoCaja.id_metodo_pago == Pago.id_metodo_pago, "
            "MovimientoCaja.monto == Pago.monto_total, "
            "MovimientoCaja.origen_financiero == Pago.origen_financiero)"
        ),
        foreign_keys=(
            "[Pago.id_movimiento_caja, Pago.id_metodo_pago, "
            "Pago.monto_total, Pago.origen_financiero]"
        ),
        back_populates="movimiento_caja",
        uselist=False,
        viewonly=True,
    )


class ArqueoCaja(Base):
    """Comparacion entre el monto del sistema y el efectivo contado."""

    __tablename__ = "arqueos_caja"

    id_arqueo: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_sesion: Mapped[int] = mapped_column(
        ForeignKey("sesiones_caja.id_sesion", name="fk_arqueos_sesion"), nullable=False
    )
    monto_sistema: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    monto_contado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    diferencia: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )

    sesion: Mapped[SesionCaja] = relationship(back_populates="arqueos")


class EntregaCobrador(Base):
    """Dinero entregado por un empleado cobrador a un administrativo."""

    __tablename__ = "entregas_cobradores"
    __table_args__ = (
        UniqueConstraint(
            "id_entrega",
            "id_empleado",
            name="uq_entregas_id_empleado",
        ),
    )

    id_entrega: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    # La base admite NULL para compatibilidad; FastAPI exige UUID en entregas nuevas.
    clave_idempotencia: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)
    id_sesion: Mapped[int] = mapped_column(
        ForeignKey("sesiones_caja.id_sesion", name="fk_entregas_sesion"), nullable=False
    )
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_entregas_empleado"), nullable=False
    )
    id_administrativo: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_entregas_administrativo"),
        nullable=False,
    )
    monto_entregado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    sesion: Mapped[SesionCaja] = relationship(back_populates="entregas")
    empleado: Mapped["Empleado"] = relationship(foreign_keys=[id_empleado])
    administrativo: Mapped["Empleado"] = relationship(
        foreign_keys=[id_administrativo]
    )
    pagos: Mapped[list["Pago"]] = relationship(back_populates="entrega")
    detalles_pago: Mapped[list["EntregaPagoDetalle"]] = relationship(
        primaryjoin=(
            "and_(EntregaCobrador.id_entrega == EntregaPagoDetalle.id_entrega, "
            "EntregaCobrador.id_empleado == EntregaPagoDetalle.id_empleado)"
        ),
        foreign_keys=(
            "[EntregaPagoDetalle.id_entrega, EntregaPagoDetalle.id_empleado]"
        ),
        viewonly=True,
    )


class EntregaPagoDetalle(Base):
    """Importe parcial de un pago incluido en una entrega fisica."""

    __tablename__ = "entrega_pago_detalles"
    __table_args__ = (
        PrimaryKeyConstraint(
            "id_entrega",
            "id_pago",
            name="pk_entrega_pago_detalles",
        ),
        ForeignKeyConstraint(
            ["id_entrega", "id_empleado"],
            ["entregas_cobradores.id_entrega", "entregas_cobradores.id_empleado"],
            name="fk_entrega_pago_detalles_entrega",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["id_pago", "id_empleado"],
            ["pagos.id_pago", "pagos.id_empleado"],
            name="fk_entrega_pago_detalles_pago",
            ondelete="RESTRICT",
        ),
        Index("ix_entrega_pago_detalles_pago", "id_pago"),
    )

    id_entrega: Mapped[int] = mapped_column()
    id_pago: Mapped[int] = mapped_column()
    id_empleado: Mapped[int] = mapped_column(nullable=False)
    monto_entregado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    monto_gasto_autorizado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)

    entrega: Mapped[EntregaCobrador] = relationship(
        primaryjoin=(
            "and_(EntregaPagoDetalle.id_entrega == EntregaCobrador.id_entrega, "
            "EntregaPagoDetalle.id_empleado == EntregaCobrador.id_empleado)"
        ),
        foreign_keys=[id_entrega, id_empleado],
        viewonly=True,
    )
    pago: Mapped["Pago"] = relationship(
        primaryjoin=(
            "and_(EntregaPagoDetalle.id_pago == Pago.id_pago, "
            "EntregaPagoDetalle.id_empleado == Pago.id_empleado)"
        ),
        foreign_keys=[id_pago, id_empleado],
        viewonly=True,
    )
