"""Pydantic schemas for customer locations."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


EstadoUbicacionCliente = Literal["Activo", "Inactivo"]
Latitud = Annotated[Decimal, Field(ge=-90, le=90, max_digits=10, decimal_places=7)]
Longitud = Annotated[Decimal, Field(ge=-180, le=180, max_digits=10, decimal_places=7)]


class UbicacionClienteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_cliente: int = Field(gt=0)
    direccion: str | None = Field(default=None, min_length=1, max_length=500)
    latitud: Latitud | None = None
    longitud: Longitud | None = None
    referencia: str | None = Field(default=None, min_length=1, max_length=500)
    observaciones: str | None = None
    estado: EstadoUbicacionCliente = "Activo"

    @classmethod
    def as_form(
        cls,
        id_cliente: Annotated[int, Form(...)],
        direccion: Annotated[str | None, Form()] = None,
        latitud: Annotated[Decimal | None, Form()] = None,
        longitud: Annotated[Decimal | None, Form()] = None,
        referencia: Annotated[str | None, Form()] = None,
        observaciones: Annotated[str | None, Form()] = None,
        estado: Annotated[EstadoUbicacionCliente, Form()] = "Activo",
    ) -> "UbicacionClienteCreate":
        try:
            return cls(
                id_cliente=id_cliente,
                direccion=direccion or None,
                latitud=latitud,
                longitud=longitud,
                referencia=referencia or None,
                observaciones=observaciones or None,
                estado=estado,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class UbicacionClienteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    direccion: str | None = Field(default=None, min_length=1, max_length=500)
    latitud: Latitud | None = None
    longitud: Longitud | None = None
    referencia: str | None = Field(default=None, min_length=1, max_length=500)
    observaciones: str | None = None
    estado: EstadoUbicacionCliente | None = None

    @field_validator("estado")
    @classmethod
    def _estado_no_nulo(cls, value: EstadoUbicacionCliente | None) -> EstadoUbicacionCliente:
        if value is None:
            raise ValueError("El estado no puede ser nulo")
        return value


class UbicacionClienteResponse(BaseModel):
    id_ubicacion: int
    id_cliente: int
    numero_propiedad: int
    nombre_cliente: str
    direccion: str | None
    latitud: Decimal | None
    longitud: Decimal | None
    foto_fachada: str | None
    referencia: str | None
    observaciones: str | None
    estado: EstadoUbicacionCliente
    fecha_registro: datetime
