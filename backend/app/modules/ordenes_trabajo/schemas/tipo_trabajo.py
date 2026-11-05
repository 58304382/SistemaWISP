"""Contratos Pydantic del catálogo de tipos de trabajo."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EstadoTipoTrabajo = Literal["Activo", "Inactivo"]


class TipoTrabajoCreate(BaseModel):
    """Alta de un tipo; el identificador y el estado por defecto se derivan."""

    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=100)
    descripcion: str | None = None
    estado: EstadoTipoTrabajo = "Activo"

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede estar vacío")
        return value


class TipoTrabajoUpdate(BaseModel):
    """Campos modificables de un tipo existente."""

    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    descripcion: str | None = None
    estado: EstadoTipoTrabajo | None = None

    @model_validator(mode="after")
    def rechazar_nulos_obligatorios(self):
        """PATCH permite omitir campos, pero no borrar nombre ni estado."""
        if any(c in self.model_fields_set and getattr(self, c) is None for c in ("nombre", "estado")):
            raise ValueError("Nombre y estado no pueden ser nulos")
        return self

    @field_validator("nombre")
    @classmethod
    def nombre_opcional_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede quedar vacío")
        return value


class TipoTrabajoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_tipo_trabajo: int
    nombre: str
    descripcion: str | None
    estado: EstadoTipoTrabajo
