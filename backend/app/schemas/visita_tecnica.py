"""Schemas Pydantic para visitas, evaluaciones y materiales."""

from datetime import date, time
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from app.schemas.ubicacion_cliente import Latitud, Longitud


EstadoVisitaTecnica = Literal["Programada", "En Proceso", "Completada"]


class VisitaTecnicaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_cliente: int = Field(gt=0)
    # La propiedad es opcional mientras el cliente no tenga una registrada.
    id_ubicacion: int | None = Field(default=None, gt=0)
    id_empleado: int = Field(gt=0)
    id_tipo_instalacion: int = Field(gt=0)
    fecha_programada: date
    hora_programada: time
    motivo_visita: str = Field(min_length=1, max_length=250)
    indicaciones: str | None = None
    observaciones: str | None = None

    @field_validator("motivo_visita")
    @classmethod
    def motivo_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El motivo no puede estar vacio")
        return value

    @classmethod
    def as_form(
        cls,
        id_cliente: Annotated[int, Form(...)],
        id_empleado: Annotated[int, Form(...)],
        id_tipo_instalacion: Annotated[int, Form(...)],
        fecha_programada: Annotated[date, Form(...)],
        hora_programada: Annotated[time, Form(...)],
        motivo_visita: Annotated[str, Form(...)],
        id_ubicacion: Annotated[int | None, Form()] = None,
        indicaciones: Annotated[str | None, Form()] = None,
        observaciones: Annotated[str | None, Form()] = None,
    ) -> "VisitaTecnicaCreate":
        try:
            return cls(
                id_cliente=id_cliente,
                id_ubicacion=id_ubicacion,
                id_empleado=id_empleado,
                id_tipo_instalacion=id_tipo_instalacion,
                fecha_programada=fecha_programada,
                hora_programada=hora_programada,
                motivo_visita=motivo_visita,
                indicaciones=indicaciones or None,
                observaciones=observaciones or None,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class VisitaTecnicaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_cliente: int | None = Field(default=None, gt=0)
    id_ubicacion: int | None = Field(default=None, gt=0)
    id_empleado: int | None = Field(default=None, gt=0)
    id_tipo_instalacion: int | None = Field(default=None, gt=0)
    fecha_programada: date | None = None
    hora_programada: time | None = None
    motivo_visita: str | None = Field(default=None, min_length=1, max_length=250)
    indicaciones: str | None = None
    observaciones: str | None = None

    @model_validator(mode="before")
    @classmethod
    def campos_obligatorios_no_nulos(cls, data: object) -> object:
        if isinstance(data, dict):
            required = {
                "id_cliente",
                "id_empleado",
                "id_tipo_instalacion",
                "fecha_programada",
                "hora_programada",
                "motivo_visita",
            }
            if any(data.get(field) is None for field in required & data.keys()):
                raise ValueError("Los campos obligatorios no pueden ser nulos")
        return data

    @field_validator("motivo_visita")
    @classmethod
    def motivo_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El motivo no puede estar vacio")
        return value


class PrimeraUbicacionVisitaCreate(BaseModel):
    """Datos capturables por el técnico sin coordenadas ni correlativos editables."""

    model_config = ConfigDict(extra="forbid")

    direccion: str = Field(min_length=1, max_length=500)
    referencia: str | None = Field(default=None, min_length=1, max_length=500)
    observaciones: str | None = None
    latitud: Latitud | None = None
    longitud: Longitud | None = None

    @model_validator(mode="after")
    def coordenadas_completas(self) -> "PrimeraUbicacionVisitaCreate":
        """Permite coordenadas nullable, pero nunca un par incompleto."""

        if (self.latitud is None) != (self.longitud is None):
            raise ValueError("La latitud y la longitud deben enviarse juntas")
        return self

    @field_validator("direccion")
    @classmethod
    def direccion_no_vacia(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La dirección no puede estar vacía")
        return value

    @classmethod
    def as_form(
        cls,
        direccion: Annotated[str, Form(...)],
        referencia: Annotated[str | None, Form()] = None,
        observaciones: Annotated[str | None, Form()] = None,
        latitud: Annotated[Decimal | None, Form()] = None,
        longitud: Annotated[Decimal | None, Form()] = None,
    ) -> "PrimeraUbicacionVisitaCreate":
        try:
            return cls(
                direccion=direccion,
                referencia=referencia or None,
                observaciones=observaciones or None,
                latitud=latitud,
                longitud=longitud,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class EvaluacionMaterialInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    descripcion: str = Field(min_length=1, max_length=200)
    cantidad: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unidad: str | None = Field(default=None, max_length=30)

    @field_validator("descripcion")
    @classmethod
    def descripcion_no_vacia(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La descripcion no puede estar vacia")
        return value


class EvaluacionVisitaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    descripcion_trabajo: str = Field(min_length=1)
    tecnicos_recomendados: int | None = Field(default=None, gt=0, le=32767)
    condiciones_lugar: str | None = None
    observacion_tecnica: str | None = None
    materiales: list[EvaluacionMaterialInput] = Field(default_factory=list)

    @field_validator("descripcion_trabajo")
    @classmethod
    def descripcion_trabajo_no_vacia(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La descripcion del trabajo es obligatoria")
        return value


class EvaluacionVisitaDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    descripcion_trabajo: str | None = Field(default=None, min_length=1)
    tecnicos_recomendados: int | None = Field(default=None, gt=0, le=32767)
    condiciones_lugar: str | None = None
    observacion_tecnica: str | None = None
    materiales: list[EvaluacionMaterialInput] | None = None

    @field_validator("descripcion_trabajo")
    @classmethod
    def descripcion_trabajo_no_vacia(cls, value: str | None) -> str:
        if value is None or not value.strip():
            raise ValueError("La descripcion del trabajo no puede quedar vacia")
        return value.strip()


class EvaluacionVisitaFinalizar(BaseModel):
    model_config = ConfigDict(extra="forbid")

    descripcion_trabajo: str = Field(min_length=1)
    tecnicos_recomendados: int | None = Field(default=None, gt=0, le=32767)
    condiciones_lugar: str | None = None
    observacion_tecnica: str | None = None
    materiales: list[EvaluacionMaterialInput] = Field(default_factory=list)

    @field_validator("descripcion_trabajo")
    @classmethod
    def texto_final_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede estar vacio")
        return value


class EvaluacionMaterialResponse(BaseModel):
    id_detalle: int
    descripcion: str
    cantidad: Decimal
    unidad: str | None


class EvaluacionVisitaResponse(BaseModel):
    id_evaluacion: int
    id_visita: int
    descripcion_trabajo: str
    tecnicos_recomendados: int | None
    condiciones_lugar: str | None
    observacion_tecnica: str | None
    materiales: list[EvaluacionMaterialResponse]


class VisitaTecnicaResponse(BaseModel):
    id_visita: int
    id_cliente: int
    id_ubicacion: int | None
    numero_propiedad: int | None
    nombre_cliente: str
    telefono_cliente: str
    direccion_cliente: str
    id_empleado: int
    nombre_tecnico: str
    id_tipo_instalacion: int
    nombre_tipo_instalacion: str
    fecha_programada: date
    hora_programada: time
    motivo_visita: str
    foto_referencia: str | None
    indicaciones: str | None
    observaciones: str | None
    estado: EstadoVisitaTecnica
    evaluacion: EvaluacionVisitaResponse | None
