"""Modelo SQLAlchemy para la gestion de clientes."""

# ==========================================
# IMPORTS
# ==========================================
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.ubicacion import Municipio

if TYPE_CHECKING:
    from app.models.instalacion import Instalacion
    from app.models.ubicacion_cliente import UbicacionCliente
    from app.models.visita_tecnica import VisitaTecnica


# ==========================================
# MODELO DE CLIENTE
# ==========================================
class Cliente(Base):
    """Registro de cliente con su municipio de residencia."""

    __tablename__ = "clientes"

    id_cliente: Mapped[int] = mapped_column(primary_key=True)
    id_municipio: Mapped[int] = mapped_column(
        ForeignKey("municipios.id_municipio"), nullable=False
    )
    nombres: Mapped[str] = mapped_column(String(150), nullable=False)
    apellidos: Mapped[str] = mapped_column(String(150), nullable=False)
    dpi: Mapped[str | None] = mapped_column(String(30), nullable=True)
    telefono: Mapped[str] = mapped_column(String(30), nullable=False)
    correo: Mapped[str | None] = mapped_column(String(254), nullable=True)
    direccion: Mapped[str] = mapped_column(String(300), nullable=False)
    referencia: Mapped[str | None] = mapped_column(String(300), nullable=True)
    estado: Mapped[str] = mapped_column(String(20), nullable=False, default="Activo")
    municipio: Mapped[Municipio] = relationship(back_populates="clientes", lazy="joined")
    visitas_tecnicas: Mapped[list["VisitaTecnica"]] = relationship(
        back_populates="cliente", passive_deletes="all"
    )
    ubicaciones_servicio: Mapped[list["UbicacionCliente"]] = relationship(
        back_populates="cliente", passive_deletes="all"
    )
    instalaciones: Mapped[list["Instalacion"]] = relationship(
        back_populates="cliente", passive_deletes="all"
    )
