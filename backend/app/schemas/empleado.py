"""Schemas Pydantic para empleados y sus catalogos relacionados."""

from datetime import date
from typing import Annotated, Literal

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationError

from app.schemas.cliente import DepartamentoResponse, MunicipioResponse


EstadoEmpleado = Literal["Activo", "Inactivo"]


class PuestoEmpleadoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_puesto: int
    nombre: str
    descripcion: str | None
    estado: EstadoEmpleado
    tiene_funciones_sistema: bool


class EmpleadoCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_puesto: int = Field(gt=0)
    id_municipio: int = Field(gt=0)
    nombres: str = Field(min_length=1, max_length=150)
    apellidos: str = Field(min_length=1, max_length=150)
    tipo_documento: str = Field(min_length=1, max_length=30)
    numero_documento: str = Field(min_length=1, max_length=30)
    telefono_principal: str = Field(min_length=1, max_length=30)
    telefono_alternativo: str | None = Field(default=None, max_length=30)
    correo: EmailStr | None = None
    direccion: str = Field(min_length=1, max_length=300)
    fecha_ingreso: date
    estado: EstadoEmpleado = "Activo"
    observaciones: str | None = None

    @classmethod
    def as_form(
        cls,
        id_puesto: Annotated[int, Form(...)],
        id_municipio: Annotated[int, Form(...)],
        nombres: Annotated[str, Form(...)],
        apellidos: Annotated[str, Form(...)],
        tipo_documento: Annotated[str, Form(...)],
        numero_documento: Annotated[str, Form(...)],
        telefono_principal: Annotated[str, Form(...)],
        direccion: Annotated[str, Form(...)],
        fecha_ingreso: Annotated[date, Form(...)],
        telefono_alternativo: Annotated[str | None, Form()] = None,
        correo: Annotated[str | None, Form()] = None,
        estado: Annotated[EstadoEmpleado, Form()] = "Activo",
        observaciones: Annotated[str | None, Form()] = None,
    ) -> "EmpleadoCreate":
        try:
            return cls(
                id_puesto=id_puesto,
                id_municipio=id_municipio,
                nombres=nombres,
                apellidos=apellidos,
                tipo_documento=tipo_documento,
                numero_documento=numero_documento,
                telefono_principal=telefono_principal,
                telefono_alternativo=telefono_alternativo or None,
                correo=correo or None,
                direccion=direccion,
                fecha_ingreso=fecha_ingreso,
                estado=estado,
                observaciones=observaciones,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class EmpleadoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_puesto: int | None = Field(default=None, gt=0)
    id_municipio: int | None = Field(default=None, gt=0)
    nombres: str | None = Field(default=None, min_length=1, max_length=150)
    apellidos: str | None = Field(default=None, min_length=1, max_length=150)
    tipo_documento: str | None = Field(default=None, min_length=1, max_length=30)
    numero_documento: str | None = Field(default=None, min_length=1, max_length=30)
    telefono_principal: str | None = Field(default=None, min_length=1, max_length=30)
    telefono_alternativo: str | None = Field(default=None, max_length=30)
    correo: EmailStr | None = None
    direccion: str | None = Field(default=None, min_length=1, max_length=300)
    fecha_ingreso: date | None = None
    estado: EstadoEmpleado | None = None
    observaciones: str | None = None


class EmpleadoResponse(BaseModel):
    id_empleado: int
    codigo: str
    nombres: str
    apellidos: str
    tipo_documento: str
    numero_documento: str
    telefono_principal: str
    telefono_alternativo: str | None
    correo: EmailStr | None
    direccion: str
    fecha_ingreso: date
    estado: EstadoEmpleado
    observaciones: str | None
    foto_perfil: str | None
    id_puesto: int
    nombre_puesto: str
    id_municipio: int
    nombre_municipio: str
    id_departamento: int
    nombre_departamento: str
