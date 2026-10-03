"""SQLAlchemy model matching the live ubicaciones_cliente table."""

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.cliente import Cliente

if TYPE_CHECKING:
    from app.models.instalacion import Instalacion


class UbicacionCliente(Base):
    __tablename__ = "ubicaciones_cliente"
    __table_args__ = (
        CheckConstraint(
            "latitud IS NULL OR latitud BETWEEN -90 AND 90",
            name="ck_ubicaciones_cliente_latitud",
        ),
        CheckConstraint(
            "longitud IS NULL OR longitud BETWEEN -180 AND 180",
            name="ck_ubicaciones_cliente_longitud",
        ),
        CheckConstraint(
            "estado IN ('Activo', 'Inactivo')",
            name="ck_ubicaciones_cliente_estado",
        ),
        CheckConstraint(
            "numero_propiedad > 0",
            name="chk_ubicaciones_cliente_numero_propiedad",
        ),
        UniqueConstraint(
            "id_cliente",
            "numero_propiedad",
            name="uq_ubicaciones_cliente_cliente_numero_propiedad",
        ),
    )

    id_ubicacion: Mapped[int] = mapped_column(primary_key=True)
    id_cliente: Mapped[int] = mapped_column(
        ForeignKey("clientes.id_cliente"), nullable=False
    )
    numero_propiedad: Mapped[int] = mapped_column(Integer, nullable=False)
    direccion: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitud: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    longitud: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    foto_fachada: Mapped[str | None] = mapped_column(String(500), nullable=True)
    referencia: Mapped[str | None] = mapped_column(String(500), nullable=True)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activo"
    )
    fecha_registro: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )

    cliente: Mapped[Cliente] = relationship(
        back_populates="ubicaciones_servicio", lazy="joined"
    )
    instalaciones: Mapped[list["Instalacion"]] = relationship(
        back_populates="ubicacion", passive_deletes="all"
    )
