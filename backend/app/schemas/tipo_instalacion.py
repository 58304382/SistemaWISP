"""Schemas Pydantic para tipos de instalacion."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


EstadoTipoInstalacion = Literal["Activo", "Inactivo"]


class TipoInstalacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_tipo_instalacion: int
    nombre: str
    descripcion: str | None
    estado: EstadoTipoInstalacion
