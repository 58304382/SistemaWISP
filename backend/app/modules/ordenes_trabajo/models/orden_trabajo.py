"""Modelos SQLAlchemy de Órdenes de Trabajo y sus entidades relacionadas.

Mapean exactamente las cinco tablas creadas en PostgreSQL:
ordenes_trabajo, orden_trabajo_equipo, evaluaciones_orden_trabajo y
finalizacion_orden (además del catálogo tipos_trabajo en tipo_trabajo.py).
"""

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
    from app.modules.empleados.models.empleado import Empleado
    from app.modules.ordenes_trabajo.models.tipo_trabajo import TipoTrabajo


class OrdenTrabajo(Base):
    """Cabecera de una orden; equipo, evaluación y cierre viven en filas propias."""

    __tablename__ = "ordenes_trabajo"
    __table_args__ = (
        UniqueConstraint(
            "id_orden",
            "id_cliente",
            name="uq_ordenes_trabajo_id_cliente",
        ),
    )

    id_orden: Mapped[int] = mapped_column(primary_key=True)
    codigo: Mapped[str] = mapped_column(String(20), nullable=False)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente"), nullable=False
    )
    id_tipo_trabajo: Mapped[int] = mapped_column(
        ForeignKey("tipos_trabajo.id_tipo_trabajo"), nullable=False
    )
    id_empleado: Mapped[int] = mapped_column(
        ForeignKey("empleados.id_empleado"), nullable=False
    )
    titulo: Mapped[str] = mapped_column(String(150), nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_recepcion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    fecha_estimada: Mapped[date | None] = mapped_column(Date, nullable=True)
    # El valor por defecto de PostgreSQL ('Pendiente') se conserva para no alterar
    # el esquema; el servicio siempre escribe 'Programada' al crear la orden.
    estado: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="Pendiente"
    )
    fecha_inicio: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True
    )

    cliente: Mapped["Cliente"] = relationship(lazy="joined")
    tipo_trabajo: Mapped["TipoTrabajo"] = relationship(
        back_populates="ordenes", lazy="joined"
    )
    empleado: Mapped["Empleado"] = relationship(lazy="joined")
    equipo: Mapped[list["EquipoOrden"]] = relationship(
        back_populates="orden",
        order_by="EquipoOrden.id_equipo",
        lazy="selectin",
        passive_deletes=True,
    )
    evaluacion: Mapped["EvaluacionOrden | None"] = relationship(
        back_populates="orden", uselist=False, lazy="joined", passive_deletes="all"
    )
    finalizacion: Mapped["FinalizacionOrden | None"] = relationship(
        back_populates="orden", uselist=False, lazy="joined", passive_deletes="all"
    )


class EquipoOrden(Base):
    """Equipo físico recibido y asociado a una orden."""

    __tablename__ = "orden_trabajo_equipo"

    id_equipo: Mapped[int] = mapped_column(primary_key=True)
    id_orden: Mapped[int] = mapped_column(
        ForeignKey("ordenes_trabajo.id_orden"), nullable=False
    )
    tipo_equipo: Mapped[str] = mapped_column(String(80), nullable=False)
    marca: Mapped[str | None] = mapped_column(String(80), nullable=True)
    modelo: Mapped[str | None] = mapped_column(String(100), nullable=True)
    numero_serie: Mapped[str | None] = mapped_column(String(100), nullable=True)
    problema_reportado: Mapped[str] = mapped_column(Text, nullable=False)
    accesorios_recibidos: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado_recepcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    orden: Mapped["OrdenTrabajo"] = relationship(back_populates="equipo")


class EvaluacionOrden(Base):
    """Diagnóstico y trabajo propuesto registrados por el técnico responsable."""

    __tablename__ = "evaluaciones_orden_trabajo"

    id_evaluacion: Mapped[int] = mapped_column(primary_key=True)
    id_orden: Mapped[int] = mapped_column(
        ForeignKey("ordenes_trabajo.id_orden"), nullable=False
    )
    fecha_evaluacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    diagnostico: Mapped[str] = mapped_column(Text, nullable=False)
    trabajo_propuesto: Mapped[str] = mapped_column(Text, nullable=False)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    orden: Mapped["OrdenTrabajo"] = relationship(back_populates="evaluacion")
    materiales: Mapped[list["EvaluacionOrdenMaterial"]] = relationship(
        back_populates="evaluacion",
        order_by="EvaluacionOrdenMaterial.id_detalle",
        passive_deletes="all",
    )


class EvaluacionOrdenMaterial(Base):
    """Material o repuesto requerido por la evaluación de una orden de trabajo."""

    __tablename__ = "evaluacion_orden_trabajo_materiales"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_eval_orden_material_cantidad"),
    )

    id_detalle: Mapped[int] = mapped_column(primary_key=True)
    id_evaluacion: Mapped[int] = mapped_column(
        ForeignKey("evaluaciones_orden_trabajo.id_evaluacion"), nullable=False
    )
    descripcion: Mapped[str] = mapped_column(String(200), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unidad: Mapped[str | None] = mapped_column(String(30), nullable=True)

    evaluacion: Mapped["EvaluacionOrden"] = relationship(back_populates="materiales")


class FinalizacionOrden(Base):
    """Cierre técnico: trabajo realizado, resultado y evidencia opcional."""

    __tablename__ = "finalizacion_orden"

    id_finalizacion: Mapped[int] = mapped_column(primary_key=True)
    id_orden: Mapped[int] = mapped_column(
        ForeignKey("ordenes_trabajo.id_orden"), nullable=False
    )
    trabajo_realizado: Mapped[str] = mapped_column(Text, nullable=False)
    resultado_solucion: Mapped[str] = mapped_column(Text, nullable=False)
    observaciones_finales: Mapped[str | None] = mapped_column(Text, nullable=True)
    fecha_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    evidencia_ruta: Mapped[str | None] = mapped_column(String(500), nullable=True)

    orden: Mapped["OrdenTrabajo"] = relationship(back_populates="finalizacion")