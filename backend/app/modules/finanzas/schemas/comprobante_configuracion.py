"""Contratos de la configuración de comprobantes de Cobros."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


EstadoConfiguracionComprobante = Literal["Activa", "Inactiva"]


class ConfiguracionComprobanteCreate(BaseModel):
    """Datos editables desde Mantenimiento → Factura / Comprobante."""

    model_config = ConfigDict(extra="forbid")

    nombre_comercial: str = Field(min_length=1, max_length=150)
    descripcion_empresa: str | None = Field(default=None, max_length=200)
    direccion: str | None = Field(default=None, max_length=300)
    telefono: str | None = Field(default=None, max_length=30)
    mensaje_final: str | None = None
    nota_fiscal: str | None = Field(default=None, max_length=200)

    @field_validator("nombre_comercial")
    @classmethod
    def validar_nombre_comercial(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre comercial es obligatorio")
        return value

    @field_validator(
        "descripcion_empresa",
        "direccion",
        "telefono",
        "mensaje_final",
    )
    @classmethod
    def normalizar_opcionales(cls, value: str | None) -> str | None:
        return None if value is None else value.strip() or None

    @field_validator("nota_fiscal")
    @classmethod
    def normalizar_nota_fiscal(cls, value: str | None) -> str | None:
        """Conserva la nota vacía para que pueda eliminarse de un comprobante."""

        return None if value is None else value.strip()


class ConfiguracionComprobanteResponse(BaseModel):
    id_configuracion: int
    version: int
    nombre_comercial: str
    descripcion_empresa: str | None
    direccion: str | None
    telefono: str | None
    mensaje_final: str | None
    nota_fiscal: str | None
    estado: EstadoConfiguracionComprobante
    fecha_creacion: datetime
    fecha_publicacion: datetime | None
