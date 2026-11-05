"""Contrato unificado de lectura para visitas, instalaciones y órdenes de trabajo."""

from datetime import date, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field
from app.modules.visitas_tecnicas.schemas.visita_tecnica import EvaluacionMaterialResponse


class TareaTecnicoResponse(BaseModel):
    id_empleado: int
    codigo: str
    nombre: str
    es_encargado: bool


class TareaResponse(BaseModel):
    id: int
    tipo: Literal["Visita Técnica", "Instalación", "Orden de Trabajo", "Soporte Técnico"]
    # FK de la fuente Soporte; las demás tareas conservan su contrato y valor nulo.
    id_ticket: int | None = None
    codigo_ticket: str | None = None
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
    # Accesorios derivados de la evaluacion de visita para las instalaciones.
    materiales: list[EvaluacionMaterialResponse] = Field(default_factory=list)
    estado: Literal["Programada", "En Proceso", "Completada"]
    id_tipo_instalacion: int | None
    tipo_instalacion: str | None
    tecnicos: list[TareaTecnicoResponse]
    ubicacion_disponible: bool
    puede_ver: bool
    puede_realizar_acciones: bool
    es_responsable: bool
    bloqueada: bool = False
    # Autoriza continuar la reparacion; la entrega usa puede_finalizar_orden y exige pago.
    reparacion_autorizada: bool = False
    # Solo órdenes de trabajo: true cuando su cotización fue RECHAZADA; el técnico
    # ve «Trabajo rechazado» y la reparación permanece bloqueada.
    trabajo_rechazado: bool = False
    # Estados de proceso de la orden (solo órdenes de trabajo): permiten decidir
    # qué acción mostrar sin añadir columnas nuevas.
    tiene_evaluacion: bool = False
    tiene_finalizacion: bool = False
    # Entrega habilitada al responsable con cotizacion COMPLETADA, incluso pendiente Q0.00.
    puede_finalizar_orden: bool = False
    # Solo órdenes de trabajo: identificador de la cotización vigente, para que el
    # técnico solicite trabajo adicional sobre la misma cotización.
    id_cotizacion: int | None = None
    # Trabajo adicional en revisión comercial (cotización reabierta con Proforma).
    trabajo_adicional_en_revision: bool = False
    # Trabajo adicional rechazado (cotización RECHAZADA con aceptación previa).
    trabajo_adicional_rechazado: bool = False
