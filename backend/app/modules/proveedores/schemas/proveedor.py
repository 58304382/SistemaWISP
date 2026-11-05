"""Contratos de entrada y salida para la gestión de proveedores."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.modules.clientes.schemas.cliente import MunicipioResponse


EstadoProveedor = Literal["Activo", "Inactivo"]


class ProveedorBase(BaseModel):
    """Campos editables compartidos por el registro y la actualización."""

    nombre: str = Field(min_length=1, max_length=150)
    nit: str | None = Field(default=None, max_length=20)
    contacto: str | None = Field(default=None, max_length=150)
    telefono: str | None = Field(default=None, max_length=20)
    correo: EmailStr | None = Field(default=None, max_length=150)
    direccion: str | None = None
    id_municipio: int = Field(gt=0)
    estado: EstadoProveedor = "Activo"
    observaciones: str | None = None

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, value: str) -> str:
        """Rechaza nombres compuestos únicamente por espacios."""

        nombre = value.strip()
        if not nombre:
            raise ValueError("El nombre es obligatorio")
        return nombre

    @field_validator("nit", "contacto", "telefono", "direccion", "observaciones")
    @classmethod
    def normalizar_texto_opcional(cls, value: str | None) -> str | None:
        """Convierte textos opcionales vacíos en valores nulos."""

        if value is None:
            return None
        return value.strip() or None


class ProveedorCreate(ProveedorBase):
    """Datos permitidos al registrar un proveedor sin solicitar su ID."""


class ProveedorUpdate(ProveedorBase):
    """Datos editables de un proveedor existente."""


class ProveedorEstadoUpdate(BaseModel):
    """Estado permitido para activar o inactivar un proveedor."""

    estado: EstadoProveedor


class ProveedorResponse(ProveedorBase):
    """Proveedor con el municipio requerido para recuperar su departamento."""

    model_config = ConfigDict(from_attributes=True)

    id_proveedor: int
    municipio: MunicipioResponse
