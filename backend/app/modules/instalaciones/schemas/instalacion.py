"""Schemas Pydantic para instalaciones y equipos tecnicos."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.modules.visitas_tecnicas.schemas.visita_tecnica import EvaluacionMaterialResponse


EstadoInstalacion = Literal["Programada", "En Proceso", "Completada"]


class TecnicoAsignacion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_empleado: int = Field(gt=0)
    es_encargado: bool = False


class EquipoTecnico(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tecnicos: list[TecnicoAsignacion] = Field(min_length=1)

    @model_validator(mode="after")
    def validar_equipo(self) -> Self:
        ids = [tecnico.id_empleado for tecnico in self.tecnicos]
        if len(ids) != len(set(ids)):
            raise ValueError("No se puede asignar el mismo tecnico mas de una vez")
        encargados = sum(tecnico.es_encargado for tecnico in self.tecnicos)
        if len(self.tecnicos) == 1:
            self.tecnicos[0].es_encargado = True
        elif encargados != 1:
            raise ValueError("Un equipo de dos o mas tecnicos debe tener exactamente un encargado")
        return self


class InstalacionCreate(EquipoTecnico):
    id_cliente: int = Field(gt=0)
    id_visita: int | None = Field(default=None, gt=0)
    id_ubicacion: int | None = Field(default=None, gt=0)
    fecha_programada: date
    hora_programada: time
    observaciones: str | None = None


class InstalacionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_cliente: int | None = Field(default=None, gt=0)
    id_visita: int | None = Field(default=None, gt=0)
    id_ubicacion: int | None = Field(default=None, gt=0)
    fecha_programada: date | None = None
    hora_programada: time | None = None
    observaciones: str | None = None
    tecnicos: list[TecnicoAsignacion] | None = Field(default=None, min_length=1)

    @model_validator(mode="before")
    @classmethod
    def campos_obligatorios_no_nulos(cls, data: object) -> object:
        if isinstance(data, dict):
            required = {"id_cliente", "fecha_programada", "hora_programada"}
            if any(data.get(field) is None for field in required & data.keys()):
                raise ValueError("Los campos obligatorios no pueden ser nulos")
        return data

    @model_validator(mode="after")
    def validar_equipo(self) -> Self:
        if self.tecnicos is not None:
            EquipoTecnico(tecnicos=self.tecnicos)
            if len(self.tecnicos) == 1:
                self.tecnicos[0].es_encargado = True
        return self


class EquipoTecnicoUpdate(EquipoTecnico):
    pass


class EncargadoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_empleado: int = Field(gt=0)


class ClienteInstalacionResponse(BaseModel):
    id_cliente: int
    nombre: str
    telefono: str
    direccion: str
    municipio: str
    # Datos de lectura del cliente relacionado; no se almacenan copias en instalaciones.
    dpi: str | None = None
    correo: str | None = None
    referencia: str | None = None
    estado: str | None = None


class VisitaInstalacionResponse(BaseModel):
    id_visita: int
    id_tipo_instalacion: int
    tipo_instalacion: str
    descripcion_evaluacion: str | None
    # Datos derivados de la evaluación; no se duplican en instalaciones.
    materiales: list[EvaluacionMaterialResponse] = Field(default_factory=list)
    fecha_programada: date | None = None
    hora_programada: time | None = None
    estado: str | None = None
    motivo_visita: str | None = None
    indicaciones: str | None = None
    observaciones: str | None = None
    nombre_tecnico: str | None = None
    foto_referencia: str | None = None
    # Complementa descripcion_evaluacion y materiales sin repetir la evaluacion completa.
    id_evaluacion: int | None = None
    tecnicos_recomendados: int | None = None
    condiciones_lugar: str | None = None
    observacion_tecnica: str | None = None


class VisitaProgramableResponse(BaseModel):
    """Visita del cliente con cotizacion COMPLETADA y su contexto tecnico real."""

    id_visita: int
    id_ubicacion: int | None
    id_cotizacion: int
    numero_cotizacion: str
    descripcion_trabajo: str
    materiales: list[EvaluacionMaterialResponse]


class UbicacionInstalacionResponse(BaseModel):
    id_ubicacion: int
    direccion: str | None
    latitud: Decimal | None
    longitud: Decimal | None
    referencia: str | None
    observaciones: str | None
    numero_propiedad: int | None = None
    foto_fachada: str | None = None
    estado: str | None = None


class TecnicoInstalacionResponse(BaseModel):
    id_empleado: int
    codigo: str
    nombres: str
    apellidos: str
    id_puesto: int
    nombre_puesto: str
    estado: str
    es_encargado: bool = False


class InstalacionResponse(BaseModel):
    id_instalacion: int
    id_cliente: int
    id_visita: int | None
    id_ubicacion: int | None
    fecha_programada: date
    hora_programada: time
    observaciones: str | None
    estado: EstadoInstalacion
    observaciones_tecnicas: str | None
    fecha_finalizacion: datetime | None
    evidencia_fotografica: str | None
    fecha_registro: datetime
    cliente: ClienteInstalacionResponse
    visita: VisitaInstalacionResponse | None
    ubicacion: UbicacionInstalacionResponse | None
    tecnicos: list[TecnicoInstalacionResponse]
    encargado: TecnicoInstalacionResponse
