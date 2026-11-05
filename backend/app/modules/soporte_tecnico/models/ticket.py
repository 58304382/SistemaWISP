"""Mapeo del esquema existente, verificado en PostgreSQL; no crea tablas."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Identity, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.modules.clientes.models.cliente import Cliente
from app.modules.empleados.models.empleado import Empleado
from app.modules.usuarios.models.usuario import Usuario


class CategoriaTicket(Base):
    """Catálogo real de categorías; este módulo únicamente lo consulta."""

    __tablename__ = "categorias_ticket"

    id_categoria: Mapped[int] = mapped_column(Identity(), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100), unique=True)
    descripcion: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(20), server_default="Activo")


class Ticket(Base):
    """Solicitud vinculada al cliente y a la FK real de empleados como técnico."""

    __tablename__ = "tickets"

    id_ticket: Mapped[int] = mapped_column(Identity(), primary_key=True)
    id_cliente: Mapped[int] = mapped_column(ForeignKey("clientes.id_cliente"))
    id_categoria: Mapped[int] = mapped_column(ForeignKey("categorias_ticket.id_categoria"))
    id_tecnico: Mapped[int | None] = mapped_column(ForeignKey("empleados.id_empleado"))
    canal: Mapped[str] = mapped_column(String(20))
    asunto: Mapped[str] = mapped_column(String(200))
    descripcion: Mapped[str] = mapped_column(Text)
    observaciones: Mapped[str | None] = mapped_column(Text)
    fecha_apertura: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    fecha_inicio: Mapped[datetime | None] = mapped_column(DateTime)
    fecha_resolucion: Mapped[datetime | None] = mapped_column(DateTime)
    estado: Mapped[str] = mapped_column(String(30), server_default="Programada")

    cliente: Mapped[Cliente] = relationship()
    categoria: Mapped[CategoriaTicket] = relationship()
    tecnico: Mapped[Empleado | None] = relationship()
    # Sin cascadas implícitas: la eliminación autorizada del historial es explícita y atómica.
    historial: Mapped[list["TicketHistorial"]] = relationship(
        back_populates="ticket", passive_deletes="all",
        order_by="(TicketHistorial.fecha_hora, TicketHistorial.id_historial)",
    )


class TicketHistorial(Base):
    """Acciones con el usuario autenticado; conserva campos técnicos para lectura futura."""

    __tablename__ = "ticket_historial"

    id_historial: Mapped[int] = mapped_column(Identity(), primary_key=True)
    id_ticket: Mapped[int] = mapped_column(ForeignKey("tickets.id_ticket"))
    id_usuario: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))
    estado_anterior: Mapped[str | None] = mapped_column(String(30))
    estado_nuevo: Mapped[str | None] = mapped_column(String(30))
    accion: Mapped[str] = mapped_column(String(100))
    observacion: Mapped[str | None] = mapped_column(Text)
    trabajo_realizado: Mapped[str | None] = mapped_column(Text)
    resultado_solucion: Mapped[str | None] = mapped_column(Text)
    evidencia_foto_ruta: Mapped[str | None] = mapped_column(String(500))
    fecha_hora: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    ticket: Mapped[Ticket] = relationship(back_populates="historial")
    usuario: Mapped[Usuario] = relationship()
