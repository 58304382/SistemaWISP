"""Contrato unificado de lectura para visitas e instalaciones asignadas."""

from datetime import date, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class TareaTecnicoResponse(BaseModel):
    id_empleado: int
    codigo: str
    nombre: str
    es_encargado: bool


class TareaResponse(BaseModel):
    id: int
    tipo: Literal["Visita Técnica", "Instalación"]
    id_visita: int | None
    id_instalacion: int | None
    id_cliente: int
    id_ubicacion: int | None
    numero_propiedad: int | None
    direccion_propiedad: str | None
    referencia_propiedad: str | None
    foto_fachada: str | None
    latitud: Decimal | None
    longitud: Decimal | None
    cliente: str
    fecha: date
    hora: time
    descripcion: str | None
    estado: Literal["Programada", "En Proceso", "Completada"]
    id_tipo_instalacion: int | None
    tipo_instalacion: str | None
    tecnicos: list[TareaTecnicoResponse]
    ubicacion_disponible: bool
    puede_ver: bool
    puede_realizar_acciones: bool
    es_responsable: bool
    bloqueada: bool = False
