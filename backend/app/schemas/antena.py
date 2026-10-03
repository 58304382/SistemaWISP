"""Contratos de entrada y salida para antenas."""

from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


EstadoAntena = Literal["Activa", "Inactiva"]
LatitudAntena = Annotated[Decimal, Field(ge=-90, le=90, max_digits=10, decimal_places=7)]
LongitudAntena = Annotated[
    Decimal, Field(ge=-180, le=180, max_digits=10, decimal_places=7)
]


class AntenaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=150)
    latitud: LatitudAntena
    longitud: LongitudAntena
    direccion_sector: str | None = Field(default=None, min_length=1, max_length=500)
    referencia: str | None = Field(default=None, min_length=1, max_length=500)
    estado: EstadoAntena = "Activa"

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre es obligatorio")
        return value

    @classmethod
    def as_form(
        cls,
        nombre: Annotated[str, Form(...)],
        latitud: Annotated[Decimal, Form(...)],
        longitud: Annotated[Decimal, Form(...)],
        direccion_sector: Annotated[str | None, Form()] = None,
        referencia: Annotated[str | None, Form()] = None,
        estado: Annotated[EstadoAntena, Form()] = "Activa",
    ) -> "AntenaCreate":
        try:
            return cls(
                nombre=nombre,
                latitud=latitud,
                longitud=longitud,
                direccion_sector=direccion_sector or None,
                referencia=referencia or None,
                estado=estado,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class AntenaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    latitud: LatitudAntena | None = None
    longitud: LongitudAntena | None = None
    direccion_sector: str | None = Field(default=None, min_length=1, max_length=500)
    referencia: str | None = Field(default=None, min_length=1, max_length=500)
    estado: EstadoAntena | None = None

    @field_validator("nombre", "estado")
    @classmethod
    def validar_obligatorios_no_nulos(cls, value: str | None) -> str:
        if value is None or not value.strip():
            raise ValueError("El campo no puede ser nulo ni vacío")
        return value.strip()

    @field_validator("latitud", "longitud")
    @classmethod
    def validar_coordenadas_no_nulas(cls, value: Decimal | None) -> Decimal:
        if value is None:
            raise ValueError("La coordenada no puede ser nula")
        return value


class AntenaResponse(BaseModel):
    id_antena: int
    nombre: str
    latitud: Decimal
    longitud: Decimal
    direccion_sector: str | None
    referencia: str | None
    foto_antena: str | None
    estado: EstadoAntena
