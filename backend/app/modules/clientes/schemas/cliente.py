"""Schemas Pydantic para catalogos geograficos y clientes."""

# ==========================================
# IMPORTS Y TIPOS COMPARTIDOS
# ==========================================
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


EstadoCliente = Literal["Activo", "Inactivo"]


# ==========================================
# RESPUESTAS DE CATALOGOS
# ==========================================
class DepartamentoResponse(BaseModel):
    """Departamento activo o inactivo expuesto por el catalogo."""

    model_config = ConfigDict(from_attributes=True)

    id_departamento: int
    nombre: str
    codigo: str | None
    estado: EstadoCliente


class MunicipioResponse(BaseModel):
    """Municipio que incluye el departamento necesario para editar un cliente."""

    model_config = ConfigDict(from_attributes=True)

    id_municipio: int
    id_departamento: int
    nombre: str
    codigo_postal: str | None
    estado: EstadoCliente


# ==========================================
# ENTRADAS DE CLIENTE
# ==========================================
class ClienteCreate(BaseModel):
    """Datos requeridos para registrar un cliente."""

    id_municipio: int = Field(gt=0)
    nombres: str = Field(min_length=1, max_length=150)
    apellidos: str = Field(min_length=1, max_length=150)
    dpi: str = Field(min_length=1, max_length=30)
    telefono: str = Field(min_length=1, max_length=30)
    correo: EmailStr | None = None
    direccion: str = Field(min_length=1, max_length=300)
    referencia: str | None = Field(default=None, max_length=300)
    estado: EstadoCliente = "Activo"


class ClienteUpdate(BaseModel):
    """Campos modificables de un cliente existente."""

    id_municipio: int | None = Field(default=None, gt=0)
    nombres: str | None = Field(default=None, min_length=1, max_length=150)
    apellidos: str | None = Field(default=None, min_length=1, max_length=150)
    dpi: str | None = Field(default=None, min_length=1, max_length=30)
    telefono: str | None = Field(default=None, min_length=1, max_length=30)
    correo: EmailStr | None = None
    direccion: str | None = Field(default=None, min_length=1, max_length=300)
    referencia: str | None = Field(default=None, max_length=300)
    estado: EstadoCliente | None = None


# ==========================================
# RESPUESTA PUBLICA DE CLIENTE
# ==========================================
class ClienteResponse(BaseModel):
    """Cliente con municipio e id de departamento para formularios de edicion."""

    model_config = ConfigDict(from_attributes=True)

    id_cliente: int
    id_municipio: int
    nombres: str
    apellidos: str
    dpi: str | None
    telefono: str
    correo: str | None
    direccion: str
    referencia: str | None
    estado: EstadoCliente
    municipio: MunicipioResponse
