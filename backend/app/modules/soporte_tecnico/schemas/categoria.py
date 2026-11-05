"""Entradas administrativas del catálogo existente de categorías de tickets."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator


class CategoriaTicketWrite(BaseModel):
    """Rechaza campos ajenos y nombres vacíos antes de consultar relaciones."""

    model_config = ConfigDict(extra="forbid")
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    descripcion: str | None = None
    estado: Literal["Activo", "Inactivo"] = "Activo"


class CategoriaTicketUpdate(BaseModel):
    """PATCH preserva campos omitidos y solo permite limpiar la descripción."""

    model_config = ConfigDict(extra="forbid")
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    descripcion: str | None = None
    estado: Literal["Activo", "Inactivo"] | None = None

    @model_validator(mode="after")
    def rechazar_nulos_obligatorios(self):
        if any(c in self.model_fields_set and getattr(self, c) is None for c in ("nombre", "estado")):
            raise ValueError("Nombre y estado no pueden ser nulos")
        return self
