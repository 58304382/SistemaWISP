"""Metadata estructural de cobros y pagos; las reglas de negocio viven en FastAPI."""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.modules.clientes.models.cliente import Cliente
    from app.modules.empleados.models.empleado import Empleado
    from app.modules.finanzas.models.caja import (
        EntregaCobrador,
        EntregaPagoDetalle,
        MovimientoCaja,
    )
    from app.modules.instalaciones.models.instalacion import Instalacion
    from app.modules.usuarios.models.usuario import Usuario


class MetodoPago(Base):
    """Catalogo de medios admitidos para pagos y movimientos de caja."""

    __tablename__ = "metodos_pago"

    id_metodo_pago: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(Text, nullable=False)

    pagos: Mapped[list["Pago"]] = relationship(back_populates="metodo_pago")
    movimientos_caja: Mapped[list["MovimientoCaja"]] = relationship(
        back_populates="metodo_pago"
    )


class Cobro(Base):
    """Obligacion de un cliente con origen financiero verificable."""

    __tablename__ = "cobros"
    __table_args__ = (
        ForeignKeyConstraint(
            ["id_instalacion", "id_cliente"],
            ["instalaciones.id_instalacion", "instalaciones.id_cliente"],
            name="fk_cobros_instalacion_cliente",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["id_orden_trabajo", "id_cliente"],
            ["ordenes_trabajo.id_orden", "ordenes_trabajo.id_cliente"],
            name="fk_cobros_orden_trabajo_cliente",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["id_cotizacion"],
            ["cotizaciones.id_cotizacion"],
            name="fk_cobros_cotizacion",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "id_cotizacion IS NULL OR origen_financiero = 'INSTALACIONES'",
            name="ck_cobros_cotizacion_origen",
        ),
        UniqueConstraint(
            "id_cobro",
            "id_cliente",
            "origen_financiero",
            name="uq_cobros_id_cliente_origen",
        ),
        Index(
            "ix_cobros_cliente_fecha",
            "id_cliente",
            text("fecha_emision DESC"),
        ),
        Index("ix_cobros_origen_estado", "origen_financiero", "estado"),
        Index(
            "ix_cobros_instalacion",
            "id_instalacion",
            postgresql_where=text("id_instalacion IS NOT NULL"),
        ),
        Index(
            "uq_cobros_orden_trabajo",
            "id_orden_trabajo",
            unique=True,
            postgresql_where=text("id_orden_trabajo IS NOT NULL"),
        ),
        Index(
            "uq_cobros_instalaciones_cotizacion",
            "id_cotizacion",
            unique=True,
            postgresql_where=text(
                "origen_financiero = 'INSTALACIONES' "
                "AND id_cotizacion IS NOT NULL"
            ),
        ),
    )

    id_cobro: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente", name="fk_cobros_cliente", ondelete="RESTRICT"),
        nullable=False,
    )
    origen_financiero: Mapped[str] = mapped_column(Text, nullable=False)
    id_instalacion: Mapped[int | None] = mapped_column(nullable=True)
    # La cotizacion identifica la obligacion de Instalaciones aun sin instalacion programada.
    id_cotizacion: Mapped[int | None] = mapped_column(nullable=True)
    # Columna preparada por la migracion 009. Se difiere para que el resto de
    # cobros siga funcionando mientras la migracion no haya sido ejecutada.
    id_orden_trabajo: Mapped[int | None] = mapped_column(
        nullable=True,
        deferred=True,
    )
    # Campo legado hasta que Servicios de Internet defina su entidad real.
    id_servicio: Mapped[int | None] = mapped_column(nullable=True)
    periodo: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_emision: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_vencimiento: Mapped[date | None] = mapped_column(Date, nullable=True)
    monto: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    estado: Mapped[str] = mapped_column(Text, nullable=False)

    cliente: Mapped["Cliente"] = relationship(foreign_keys=[id_cliente])
    instalacion: Mapped["Instalacion | None"] = relationship(
        primaryjoin=(
            "and_(Cobro.id_instalacion == Instalacion.id_instalacion, "
            "Cobro.id_cliente == Instalacion.id_cliente)"
        ),
        foreign_keys=[id_instalacion, id_cliente],
        viewonly=True,
    )
    detalles_pago: Mapped[list["PagoDetalle"]] = relationship(
        primaryjoin=(
            "and_(Cobro.id_cobro == PagoDetalle.id_cobro, "
            "Cobro.id_cliente == PagoDetalle.id_cliente, "
            "Cobro.origen_financiero == PagoDetalle.origen_financiero)"
        ),
        foreign_keys=(
            "[PagoDetalle.id_cobro, PagoDetalle.id_cliente, "
            "PagoDetalle.origen_financiero]"
        ),
        back_populates="cobro",
        viewonly=True,
    )
    gestiones: Mapped[list["GestionCobro"]] = relationship(back_populates="cobro")


class Pago(Base):
    """Pago recibido y posteriormente aplicable a uno o varios cobros."""

    __tablename__ = "pagos"
    __table_args__ = (
        ForeignKeyConstraint(
            [
                "id_movimiento_caja",
                "id_metodo_pago",
                "monto_total",
                "origen_financiero",
            ],
            [
                "movimientos_caja.id_movimiento",
                "movimientos_caja.id_metodo_pago",
                "movimientos_caja.monto",
                "movimientos_caja.origen_financiero",
            ],
            name="fk_pagos_movimiento_integridad",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "clave_idempotencia",
            name="uq_pagos_clave_idempotencia",
        ),
        UniqueConstraint(
            "id_movimiento_caja",
            name="uq_pagos_movimiento_caja",
        ),
        UniqueConstraint(
            "id_pago",
            "id_cliente",
            "origen_financiero",
            name="uq_pagos_id_cliente_origen",
        ),
        UniqueConstraint(
            "id_pago",
            "id_empleado",
            name="uq_pagos_id_empleado",
        ),
        Index(
            "ix_pagos_cliente_fecha",
            "id_cliente",
            text("fecha_hora DESC"),
        ),
    )

    id_pago: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente", name="fk_pagos_cliente", ondelete="RESTRICT"),
        nullable=False,
    )
    origen_financiero: Mapped[str] = mapped_column(Text, nullable=False)
    id_movimiento_caja: Mapped[int] = mapped_column(nullable=False)
    clave_idempotencia: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    id_metodo_pago: Mapped[int] = mapped_column(
        ForeignKey("metodos_pago.id_metodo_pago", name="fk_pagos_metodo"),
        nullable=False,
    )
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_pagos_empleado"), nullable=False
    )
    # La recepción física y el usuario de registro son independientes; NULL conserva históricos.
    recepcion_efectivo: Mapped[str | None] = mapped_column(Text, nullable=True)
    id_usuario_registro: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", name="fk_pagos_usuario_registro"), nullable=True
    )
    id_entrega: Mapped[int | None] = mapped_column(
        ForeignKey("entregas_cobradores.id_entrega", name="fk_pagos_entrega"),
        nullable=True,
    )
    monto_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # La columna existente solo clasifica pagos de Ordenes de Trabajo.
    # Los registros historicos y otros origenes conservan NULL.
    tipo_pago: Mapped[str | None] = mapped_column(String(20), nullable=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    referencia: Mapped[str | None] = mapped_column(String(100), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    cliente: Mapped["Cliente"] = relationship(foreign_keys=[id_cliente])
    metodo_pago: Mapped[MetodoPago] = relationship(back_populates="pagos")
    empleado: Mapped["Empleado"] = relationship()
    movimiento_caja: Mapped["MovimientoCaja"] = relationship(
        primaryjoin=(
            "and_(Pago.id_movimiento_caja == MovimientoCaja.id_movimiento, "
            "Pago.id_metodo_pago == MovimientoCaja.id_metodo_pago, "
            "Pago.monto_total == MovimientoCaja.monto, "
            "Pago.origen_financiero == MovimientoCaja.origen_financiero)"
        ),
        foreign_keys=(
            "[Pago.id_movimiento_caja, Pago.id_metodo_pago, "
            "Pago.monto_total, Pago.origen_financiero]"
        ),
        back_populates="pago",
        uselist=False,
        viewonly=True,
    )
    entrega: Mapped["EntregaCobrador | None"] = relationship(back_populates="pagos")
    detalles: Mapped[list["PagoDetalle"]] = relationship(
        primaryjoin=(
            "and_(Pago.id_pago == PagoDetalle.id_pago, "
            "Pago.id_cliente == PagoDetalle.id_cliente, "
            "Pago.origen_financiero == PagoDetalle.origen_financiero)"
        ),
        foreign_keys=(
            "[PagoDetalle.id_pago, PagoDetalle.id_cliente, "
            "PagoDetalle.origen_financiero]"
        ),
        back_populates="pago",
        viewonly=True,
    )
    detalles_entrega: Mapped[list["EntregaPagoDetalle"]] = relationship(
        primaryjoin=(
            "and_(Pago.id_pago == EntregaPagoDetalle.id_pago, "
            "Pago.id_empleado == EntregaPagoDetalle.id_empleado)"
        ),
        foreign_keys=(
            "[EntregaPagoDetalle.id_pago, EntregaPagoDetalle.id_empleado]"
        ),
        viewonly=True,
    )
    comprobantes: Mapped[list["ComprobanteCobro"]] = relationship(back_populates="pago")


class PagoDetalle(Base):
    """Aplicacion de un pago a un cobro mediante su clave primaria compuesta."""

    __tablename__ = "pago_detalles"
    __table_args__ = (
        ForeignKeyConstraint(
            ["id_pago", "id_cliente", "origen_financiero"],
            ["pagos.id_pago", "pagos.id_cliente", "pagos.origen_financiero"],
            name="fk_pago_detalles_pago_propietario",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["id_cobro", "id_cliente", "origen_financiero"],
            ["cobros.id_cobro", "cobros.id_cliente", "cobros.origen_financiero"],
            name="fk_pago_detalles_cobro_propietario",
            ondelete="RESTRICT",
        ),
        Index(
            "ix_pago_detalles_cobro_propietario",
            "id_cobro",
            "id_cliente",
            "origen_financiero",
        ),
    )

    id_pago: Mapped[int] = mapped_column(
        ForeignKey("pagos.id_pago", name="fk_pago_detalles_pago"), primary_key=True
    )
    id_cobro: Mapped[int] = mapped_column(
        ForeignKey("cobros.id_cobro", name="fk_pago_detalles_cobro"), primary_key=True
    )
    id_cliente: Mapped[int] = mapped_column(nullable=False)
    origen_financiero: Mapped[str] = mapped_column(Text, nullable=False)
    concepto: Mapped[str | None] = mapped_column(Text, nullable=True)
    monto_aplicado: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    pago: Mapped[Pago] = relationship(
        primaryjoin=(
            "and_(PagoDetalle.id_pago == Pago.id_pago, "
            "PagoDetalle.id_cliente == Pago.id_cliente, "
            "PagoDetalle.origen_financiero == Pago.origen_financiero)"
        ),
        foreign_keys=[id_pago, id_cliente, origen_financiero],
        back_populates="detalles",
        viewonly=True,
    )
    cobro: Mapped[Cobro] = relationship(
        primaryjoin=(
            "and_(PagoDetalle.id_cobro == Cobro.id_cobro, "
            "PagoDetalle.id_cliente == Cobro.id_cliente, "
            "PagoDetalle.origen_financiero == Cobro.origen_financiero)"
        ),
        foreign_keys=[id_cobro, id_cliente, origen_financiero],
        back_populates="detalles_pago",
        viewonly=True,
    )


class ComprobanteCobro(Base):
    """Comprobante documental emitido para un pago."""

    __tablename__ = "comprobantes_cobro"

    id_comprobante: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_pago: Mapped[int] = mapped_column(
        ForeignKey("pagos.id_pago", name="fk_comprobantes_pago"), nullable=False
    )
    numero: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_emision: Mapped[date] = mapped_column(Date, nullable=False)
    archivo_pdf: Mapped[str | None] = mapped_column(Text, nullable=True)

    pago: Mapped[Pago] = relationship(back_populates="comprobantes")


class GestionCobro(Base):
    """Seguimiento realizado sobre un cobro pendiente."""

    __tablename__ = "gestiones_cobro"

    id_gestion: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    id_cobro: Mapped[int] = mapped_column(
        ForeignKey("cobros.id_cobro", name="fk_gestiones_cobro"), nullable=False
    )
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado", name="fk_gestiones_empleado"),
        nullable=False,
    )
    id_usuario: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", name="fk_gestiones_usuario"), nullable=False
    )
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    resultado: Mapped[str | None] = mapped_column(Text, nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    cobro: Mapped[Cobro] = relationship(back_populates="gestiones")
    empleado: Mapped["Empleado"] = relationship()
    usuario: Mapped["Usuario"] = relationship()
