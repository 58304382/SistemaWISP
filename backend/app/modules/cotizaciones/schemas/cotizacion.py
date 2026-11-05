"""Contratos de entrada y salida para Cotizaciones y Proformas."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import Form
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic import ValidationError


OrigenCotizacion = Literal["DIRECTA", "EVALUACION", "ORDEN_TRABAJO"]
EstadoCotizacion = Literal[
    "EN PROCESO", "GENERADA", "ACEPTADA", "RECHAZADA", "COMPLETADA"
]
EstadoConfiguracionDocumento = Literal["Borrador", "Activo", "Inactivo"]


class ConfiguracionDocumentoCreate(BaseModel):
    """Datos editables; versión, estado y ruta del logo se derivan en backend."""

    model_config = ConfigDict(extra="forbid")

    nombre_comercial: str = Field(min_length=1, max_length=150)
    nit: str | None = Field(default=None, max_length=20)
    direccion: str | None = None
    telefono: str | None = Field(default=None, max_length=25)
    correo: str | None = Field(default=None, max_length=150)
    terminos_cotizacion: str | None = None
    terminos_proforma: str | None = None
    mensaje_final: str | None = None

    @field_validator("nombre_comercial")
    @classmethod
    def validar_nombre_comercial(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre comercial es obligatorio")
        return value

    @field_validator(
        "nit",
        "direccion",
        "telefono",
        "correo",
        "terminos_cotizacion",
        "terminos_proforma",
        "mensaje_final",
    )
    @classmethod
    def normalizar_opcionales(cls, value: str | None) -> str | None:
        return None if value is None else value.strip() or None

    @field_validator("correo")
    @classmethod
    def validar_correo(cls, value: str | None) -> str | None:
        if value is not None and ("@" not in value or value.startswith("@") or value.endswith("@")):
            raise ValueError("El correo no es válido")
        return value

    @classmethod
    def as_form(
        cls,
        nombre_comercial: Annotated[str, Form(...)],
        nit: Annotated[str | None, Form()] = None,
        direccion: Annotated[str | None, Form()] = None,
        telefono: Annotated[str | None, Form()] = None,
        correo: Annotated[str | None, Form()] = None,
        terminos_cotizacion: Annotated[str | None, Form()] = None,
        terminos_proforma: Annotated[str | None, Form()] = None,
        mensaje_final: Annotated[str | None, Form()] = None,
    ) -> "ConfiguracionDocumentoCreate":
        try:
            return cls(
                nombre_comercial=nombre_comercial,
                nit=nit,
                direccion=direccion,
                telefono=telefono,
                correo=correo,
                terminos_cotizacion=terminos_cotizacion,
                terminos_proforma=terminos_proforma,
                mensaje_final=mensaje_final,
            )
        except ValidationError as error:
            raise RequestValidationError(error.errors()) from error


class ConfiguracionDocumentoResponse(BaseModel):
    id_configuracion: int
    version: int
    nombre_comercial: str
    nit: str | None
    direccion: str | None
    telefono: str | None
    correo: str | None
    logo_url: str | None
    terminos_cotizacion: str | None
    terminos_proforma: str | None
    mensaje_final: str | None
    estado: EstadoConfiguracionDocumento
    fecha_creacion: datetime


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


class CotizacionOrdenEvaluacionCreate(BaseModel):
    """Alta desde la evaluación de una orden de trabajo.

    Cliente, trabajo propuesto, materiales y unidades se derivan de la
    evaluación persistida; el administrador fija precios después de la creación
    (estado EN PROCESO)."""

    model_config = ConfigDict(extra="forbid")

    id_evaluacion_orden: int = Field(gt=0)
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


class TrabajoAdicionalCreate(BaseModel):
    """Trabajo adicional reportado por el técnico asignado a la orden.

    Reutiliza la cotización vigente: sólo describe conceptos y materiales sin
    precios (los fija después el administrador). No permite alterar cliente,
    evaluación, origen ni estado."""

    model_config = ConfigDict(extra="forbid")

    detalles: list[DetalleCotizacionInput] = Field(min_length=1)


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


class MaterialEvaluacionPendienteResponse(BaseModel):
    """Material pendiente de cotizar tomado de la evaluación de la orden."""

    descripcion: str
    cantidad: Decimal
    unidad: str | None


class OrdenEvaluacionPendienteResponse(BaseModel):
    """Evaluación de orden aún sin cotización que la referencie (pendiente)."""

    id_evaluacion: int
    id_orden: int
    id_cliente: int
    nombre_cliente: str
    nombre_tipo_trabajo: str
    trabajo_propuesto: str
    observaciones: str | None
    fecha_evaluacion: datetime
    materiales: list[MaterialEvaluacionPendienteResponse]


class CotizacionResponse(BaseModel):
    id_cotizacion: int
    numero_cotizacion: str
    fecha: date
    fecha_actualizacion: datetime
    origen: OrigenCotizacion
    id_evaluacion: int | None
    id_evaluacion_orden: int | None
    # Nombre del tipo de trabajo para el origen ORDEN_TRABAJO en la interfaz.
    tipo_trabajo: str | None
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
