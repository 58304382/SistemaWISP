"""Contratos de entrada y salida para Cotizaciones y Proformas."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


OrigenCotizacion = Literal["DIRECTA", "EVALUACION"]
EstadoCotizacion = Literal[
    "EN PROCESO", "GENERADA", "ACEPTADA", "RECHAZADA", "COMPLETADA"
]


class DetalleCotizacionInput(BaseModel):
    """Concepto editable; no acepta IDs de productos ni campos calculados."""

    model_config = ConfigDict(extra="forbid")

    descripcion: str = Field(min_length=1, max_length=200)
    cantidad: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    unidad: str | None = Field(default=None, max_length=20)
    precio_unitario: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )

    @field_validator("descripcion")
    @classmethod
    def descripcion_no_vacia(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La descripcion no puede estar vacia")
        return value

    @field_validator("unidad")
    @classmethod
    def unidad_normalizada(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class DetalleCotizacionDirectaInput(DetalleCotizacionInput):
    precio_unitario: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class CotizacionDirectaCreate(BaseModel):
    """Alta directa; numero, fecha, origen, estado y autor se derivan en backend."""

    model_config = ConfigDict(extra="forbid")

    id_cliente: int = Field(gt=0)
    porcentaje_descuento: Decimal = Field(
        default=Decimal("0.00"), ge=0, le=100, max_digits=5, decimal_places=2
    )
    observaciones: str | None = None
    detalles: list[DetalleCotizacionDirectaInput] = Field(min_length=1)


class CotizacionEvaluacionCreate(BaseModel):
    """Alta desde evaluacion; cliente y materiales nunca se reciben de Angular."""

    model_config = ConfigDict(extra="forbid")

    id_evaluacion: int = Field(gt=0)
    porcentaje_descuento: Decimal = Field(
        default=Decimal("0.00"), ge=0, le=100, max_digits=5, decimal_places=2
    )
    observaciones: str | None = None


class CotizacionUpdate(BaseModel):
    """Edicion economica sin permitir origen, cliente, evaluacion ni estado."""

    model_config = ConfigDict(extra="forbid")

    porcentaje_descuento: Decimal | None = Field(
        default=None, ge=0, le=100, max_digits=5, decimal_places=2
    )
    observaciones: str | None = None
    detalles: list[DetalleCotizacionInput] | None = Field(default=None, min_length=1)

    @model_validator(mode="before")
    @classmethod
    def campos_economicos_no_nulos(cls, data: object) -> object:
        # Los campos son opcionales para PATCH, pero no pueden anularse cuando
        # el cliente decide enviarlos porque las reglas economicas los requieren.
        if isinstance(data, dict) and any(
            field in data and data[field] is None
            for field in ("porcentaje_descuento", "detalles")
        ):
            raise ValueError("Descuento y detalles no pueden ser nulos")
        return data


class ClienteCotizacionResponse(BaseModel):
    id_cliente: int
    nombres: str
    apellidos: str
    telefono: str
    direccion: str
    departamento: str
    municipio: str


class DetalleCotizacionResponse(BaseModel):
    id_detalle: int
    descripcion: str
    cantidad: Decimal
    unidad: str | None
    precio_unitario: Decimal | None
    subtotal_detalle: Decimal


class ProformaResumenResponse(BaseModel):
    id_proforma: int
    fecha_generacion: datetime


class CotizacionResponse(BaseModel):
    id_cotizacion: int
    numero_cotizacion: str
    fecha: date
    fecha_actualizacion: datetime
    origen: OrigenCotizacion
    id_evaluacion: int | None
    estado: EstadoCotizacion
    porcentaje_descuento: Decimal
    observaciones: str | None
    cliente: ClienteCotizacionResponse
    detalles: list[DetalleCotizacionResponse]
    subtotal: Decimal
    monto_descuento: Decimal
    total: Decimal
    tiene_proforma: bool
    proforma: ProformaResumenResponse | None


class ProformaResponse(BaseModel):
    """Documento derivado; todos los datos comerciales proceden de Cotizacion."""

    id_proforma: int
    fecha_generacion: datetime
    cotizacion: CotizacionResponse
