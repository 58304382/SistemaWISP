"""Modelo SQLAlchemy de la tabla PostgreSQL existente de antenas."""

from decimal import Decimal

from sqlalchemy import CheckConstraint, Identity, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Antena(Base):
    __tablename__ = "antenas"
    __table_args__ = (
        CheckConstraint("latitud BETWEEN -90 AND 90", name="ck_antenas_latitud"),
        CheckConstraint("longitud BETWEEN -180 AND 180", name="ck_antenas_longitud"),
        CheckConstraint("estado IN ('Activa', 'Inactiva')", name="ck_antenas_estado"),
    )

    id_antena: Mapped[int] = mapped_column(Identity(always=True), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    latitud: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    longitud: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    direccion_sector: Mapped[str | None] = mapped_column(String(500), nullable=True)
    referencia: Mapped[str | None] = mapped_column(String(500), nullable=True)
    foto_antena: Mapped[str | None] = mapped_column(String(500), nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Activa"
    )
