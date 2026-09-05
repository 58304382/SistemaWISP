"""Schemas públicos para usuarios y módulos."""

# ==========================================
# IMPORTS
# ==========================================
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ==========================================
# RESPUESTAS DE CATALOGOS
# ==========================================
class ModuloResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    codigo: str
    activo: bool


class RolResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str


# ==========================================
# ENTRADAS DE USUARIO
# ==========================================
class UsuarioCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=150)
    apellido: str = Field(min_length=1, max_length=150)
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8)
    rol_id: int = Field(gt=0)
    activo: bool = True
    modulo_ids: list[int] = Field(min_length=2)


class UsuarioUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    apellido: str | None = Field(default=None, min_length=1, max_length=150)
    username: str | None = Field(default=None, min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=8)
    rol_id: int | None = Field(default=None, gt=0)
    activo: bool | None = None
    modulo_ids: list[int] | None = Field(default=None, min_length=2)


# ==========================================
# RESPUESTA PUBLICA DE USUARIO
# ==========================================
class UsuarioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    apellido: str
    username: str
    rol_id: int
    activo: bool
    created_at: datetime | None
    updated_at: datetime | None
    rol: RolResponse
    modulos: list[ModuloResponse] = Field(default_factory=list)
