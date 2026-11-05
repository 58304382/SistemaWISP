"""Contratos de Soporte: no se admiten identificadores generados ni cambios de estado."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

EstadoTicket = Literal["Programada", "En Proceso", "Completada"]
CanalTicket = Literal["Llamada", "Presencial"]
TextoObligatorio = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class TicketWrite(BaseModel):
    """Registro y edición completos; la asignación es obligatoria para tickets nuevos."""

    model_config = ConfigDict(extra="forbid")
    id_cliente: int = Field(gt=0)
    id_categoria: int = Field(gt=0)
    id_tecnico: int = Field(gt=0)
    canal: CanalTicket
    asunto: TextoObligatorio = Field(max_length=200)
    descripcion: TextoObligatorio
    observaciones: str | None = None

    @field_validator("observaciones")
    @classmethod
    def limpiar_observaciones(cls, value: str | None) -> str | None:
        """Guarda notas vacías como NULL y elimina espacios accidentales."""
        return (value.strip() or None) if value is not None else None


class CategoriaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id_categoria: int
    nombre: str
    descripcion: str | None
    estado: str


class SoporteFinalizacion(BaseModel):
    """Informe obligatorio; la imagen se valida y normaliza aparte como archivo multipart."""

    model_config = ConfigDict(extra="forbid")
    trabajo_realizado: TextoObligatorio
    resultado_solucion: TextoObligatorio
    observaciones: str | None = None


class ClienteOption(BaseModel):
    id_cliente: int
    nombre: str
    telefono: str


class TecnicoOption(BaseModel):
    id_empleado: int
    nombres: str
    apellidos: str
    codigo: str


class HistorialResponse(BaseModel):
    """Historial de lectura sin contraseñas ni otros datos privados del usuario."""

    id_historial: int
    id_usuario: int
    usuario: str
    estado_anterior: str | None
    estado_nuevo: str | None
    accion: str
    observacion: str | None
    trabajo_realizado: str | None
    resultado_solucion: str | None
    evidencia_foto_ruta: str | None
    fecha_hora: datetime


class TicketResponse(BaseModel):
    """El código visible deriva de la identidad real y no requiere una columna adicional."""

    id_ticket: int
    codigo: str
    id_cliente: int
    cliente: str
    telefono_cliente: str
    id_categoria: int
    categoria: str
    id_tecnico: int | None
    tecnico: str | None
    canal: str
    asunto: str
    descripcion: str
    observaciones: str | None
    fecha_apertura: datetime
    fecha_inicio: datetime | None
    fecha_resolucion: datetime | None
    estado: str


class TicketDetalle(TicketResponse):
    historial: list[HistorialResponse]
