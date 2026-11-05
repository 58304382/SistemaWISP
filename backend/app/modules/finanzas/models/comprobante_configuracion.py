"""Modelo ORM de la configuración versionada de comprobantes de Cobros."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ConfiguracionComprobante(Base):
    """Datos institucionales publicados para los comprobantes térmicos.

    La tabla ya existe en PostgreSQL y no se modifica desde la aplicación.
    El versionado y la activación se gestionan desde el servicio.
    """

    __tablename__ = "configuracion_comprobantes"

    id_configuracion: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    nombre_comercial: Mapped[str] = mapped_column(String(150), nullable=False)
    descripcion_empresa: Mapped[str | None] = mapped_column(String(200), nullable=True)
    direccion: Mapped[str | None] = mapped_column(String(300), nullable=True)
    telefono: Mapped[str | None] = mapped_column(String(30), nullable=True)
    mensaje_final: Mapped[str | None] = mapped_column(Text, nullable=True)
    nota_fiscal: Mapped[str | None] = mapped_column(String(200), nullable=True)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="Inactiva"
    )
    fecha_creacion: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.current_timestamp()
    )
    fecha_publicacion: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
