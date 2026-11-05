"""Schemas Pydantic para tipos de instalacion."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EstadoTipoInstalacion = Literal["Activo", "Inactivo"]


class TipoInstalacionCreate(BaseModel):
    """Datos editables al registrar un tipo de instalacion."""

    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=100)
    descripcion: str | None = Field(default=None, max_length=250)
    estado: EstadoTipoInstalacion = "Activo"

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, value: str) -> str:
        """Evita nombres compuestos solo por espacios."""

        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede estar vacio")
        return value

    @field_validator("descripcion")
    @classmethod
    def descripcion_normalizada(cls, value: str | None) -> str | None:
        """Convierte una descripcion vacia en nula."""

        if value is None:
            return None
        return value.strip() or None


class TipoInstalacionUpdate(BaseModel):
    """Campos modificables de un tipo existente."""

    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    descripcion: str | None = Field(default=None, max_length=250)
    estado: EstadoTipoInstalacion | None = None

    @model_validator(mode="after")
    def rechazar_nulos_obligatorios(self):
        """Omitir un campo en PATCH no equivale a asignar NULL en PostgreSQL."""
        if any(c in self.model_fields_set and getattr(self, c) is None for c in ("nombre", "estado")):
            raise ValueError("Nombre y estado no pueden ser nulos")
        return self

    @field_validator("nombre")
    @classmethod
    def nombre_opcional_no_vacio(cls, value: str | None) -> str | None:
        """Conserva la validacion del nombre cuando se actualiza."""

        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede quedar vacio")
        return value

    @field_validator("descripcion")
    @classmethod
    def descripcion_opcional_normalizada(cls, value: str | None) -> str | None:
        """Permite limpiar la descripcion enviando null o espacios."""

        if value is None:
            return None
        return value.strip() or None


class TipoInstalacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_tipo_instalacion: int
    nombre: str
    descripcion: str | None
    estado: EstadoTipoInstalacion
