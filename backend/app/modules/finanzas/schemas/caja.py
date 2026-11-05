"""Contratos Pydantic para la operacion de caja general."""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.modules.finanzas.schemas.cobros import (
    EstadoCatalogo,
    FinanzasInput,
    FinanzasResponse,
    OrigenFinanciero,
)


class CategoriaCajaCreate(FinanzasInput):
    nombre: str = Field(min_length=1)
    tipo: Literal["Ingreso", "Egreso"]
    descripcion: str | None = None
    estado: EstadoCatalogo
    origen_financiero: OrigenFinanciero | None = None

    @field_validator("nombre")
    @classmethod
    def texto_obligatorio_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacio")
        return value

    @model_validator(mode="after")
    def validar_origen_automatico(self) -> Self:
        """Las categorias automaticas representan exclusivamente ingresos."""

        if self.origen_financiero is not None and self.tipo != "Ingreso":
            raise ValueError("Una categoria automatica debe ser de Ingreso")
        return self


class CategoriaCajaUpdate(FinanzasInput):
    nombre: str | None = Field(default=None, min_length=1)
    tipo: Literal["Ingreso", "Egreso"] | None = None
    descripcion: str | None = None
    estado: EstadoCatalogo | None = None
    origen_financiero: OrigenFinanciero | None = None

    @field_validator("nombre")
    @classmethod
    def texto_opcional_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacio")
        return value

    @model_validator(mode="after")
    def validar_origen_incluido(self) -> Self:
        """Rechaza una categoria automatica declarada expresamente como egreso."""

        if self.origen_financiero is not None and self.tipo == "Egreso":
            raise ValueError("Una categoria automatica debe ser de Ingreso")
        return self


class CategoriaCajaResponse(FinanzasResponse):
    id_categoria: int
    nombre: str
    tipo: Literal["Ingreso", "Egreso"]
    descripcion: str | None
    estado: EstadoCatalogo
    origen_financiero: OrigenFinanciero | None = None


class SesionCajaCreate(FinanzasInput):
    id_empleado: int = Field(gt=0)
    fecha_apertura: datetime
    saldo_inicial: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    estado: Literal["Abierta"]


class SesionCajaCierre(FinanzasInput):
    fecha_cierre: datetime
    saldo_final: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    estado: Literal["Cerrada"]


class SesionCajaResponse(FinanzasResponse):
    id_sesion: int
    id_empleado: int
    fecha_apertura: datetime
    fecha_cierre: datetime | None
    saldo_inicial: Decimal
    saldo_final: Decimal | None
    estado: Literal["Abierta", "Cerrada"]


class MovimientoCajaCreate(FinanzasInput):
    id_sesion: int = Field(gt=0)
    id_categoria: int = Field(gt=0)
    id_metodo_pago: int | None = Field(default=None, gt=0)
    id_responsable: int = Field(gt=0)
    tipo: Literal["Ingreso", "Egreso"]
    origen_financiero: OrigenFinanciero | None = None
    concepto: str = Field(min_length=1)
    monto: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    referencia: str | None = None
    id_salida_producto: int | None = Field(default=None, gt=0)
    observaciones: str | None = None

    @field_validator("concepto")
    @classmethod
    def texto_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacio")
        return value

    @model_validator(mode="after")
    def validar_origen_automatico(self) -> Self:
        """Todo movimiento con origen financiero debe ser un ingreso."""

        if self.origen_financiero is not None and self.tipo != "Ingreso":
            raise ValueError("Un movimiento automatico debe ser de Ingreso")
        return self


class MovimientoCajaResponse(FinanzasResponse):
    id_movimiento: int
    id_sesion: int
    id_categoria: int
    id_metodo_pago: int | None
    id_responsable: int
    tipo: Literal["Ingreso", "Egreso"]
    # NULL identifica movimientos manuales; la clave siempre forma parte de la respuesta.
    origen_financiero: OrigenFinanciero | None
    concepto: str
    monto: Decimal
    referencia: str | None
    id_salida_producto: int | None
    observaciones: str | None
    fecha_hora: datetime


class ArqueoCajaCreate(FinanzasInput):
    id_sesion: int = Field(gt=0)
    monto_sistema: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    monto_contado: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    diferencia: Decimal = Field(max_digits=10, decimal_places=2)
    observaciones: str | None = None

    @model_validator(mode="after")
    def validar_diferencia(self) -> Self:
        if self.diferencia != self.monto_contado - self.monto_sistema:
            raise ValueError("La diferencia debe coincidir con contado menos sistema")
        return self


class ArqueoCajaResponse(FinanzasResponse):
    id_arqueo: int
    id_sesion: int
    monto_sistema: Decimal
    monto_contado: Decimal
    diferencia: Decimal
    observaciones: str | None
    fecha_hora: datetime


class EntregaCobradorCreate(FinanzasInput):
    id_sesion: int = Field(gt=0)
    id_empleado: int = Field(gt=0)
    id_administrativo: int = Field(gt=0)
    monto_entregado: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    observaciones: str | None = None


class EntregaCobradorResponse(FinanzasResponse):
    id_entrega: int
    id_sesion: int
    id_empleado: int
    id_administrativo: int
    monto_entregado: Decimal
    fecha_hora: datetime
    observaciones: str | None


class EntregaPagoDetalleCreate(FinanzasInput):
    """Asigna parcialmente un pago a una entrega sin crear otro ingreso."""

    id_pago: int = Field(gt=0)
    monto_entregado: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class EntregaPagoDetalleResponse(FinanzasResponse):
    id_entrega: int
    id_pago: int
    id_empleado: int
    monto_entregado: Decimal


# ==========================================
# CONTRATOS DE CAJA GENERAL
# ==========================================
class AperturaCajaCreate(FinanzasInput):
    """Recibe solo el efectivo inicial; identidad, fecha y estado son internos."""

    saldo_inicial: Decimal = Field(ge=0, max_digits=10, decimal_places=2)


class MovimientoManualCajaCreate(FinanzasInput):
    """Movimiento manual sin aceptar sesion, responsable ni fecha del cliente."""

    tipo: Literal["Ingreso", "Egreso"]
    id_categoria: int = Field(gt=0)
    concepto: str = Field(min_length=1)
    monto: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    id_metodo_pago: int = Field(gt=0)
    referencia: str | None = None
    observaciones: str | None = None

    @field_validator("concepto")
    @classmethod
    def concepto_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El concepto no puede estar vacio")
        return value

    @field_validator("referencia", "observaciones")
    @classmethod
    def texto_opcional_normalizado(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class SesionCajaActualResponse(SesionCajaResponse):
    """Sesion unica abierta con el efectivo fisico calculado."""

    efectivo_disponible: Decimal


class CierreCajaCreate(FinanzasInput):
    """Recibe el conteo; el monto mostrado solo permite detectar un resumen obsoleto.

    El servidor calcula el esperado y la diferencia. La identidad, fecha y estado
    nunca se aceptan desde Angular.
    """

    monto_contado: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    monto_sistema: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    observaciones: str | None = None

    @field_validator("observaciones")
    @classmethod
    def observaciones_normalizadas(cls, value: str | None) -> str | None:
        """Conserva las observaciones opcionales sin espacios exteriores."""

        if value is None:
            return None
        return value.strip() or None


class CierreCajaResponse(SesionCajaActualResponse):
    """Sesion cerrada y arqueo persistidos juntos, sin crear movimientos."""

    estado: Literal["Cerrada"]
    arqueo: ArqueoCajaResponse


class MovimientoCajaDetalleResponse(MovimientoCajaResponse):
    """Movimiento confirmado con nombres de catalogo y responsable."""

    categoria: str
    metodo_pago: str | None
    responsable: str
    es_efectivo: bool


class MovimientosCajaPageResponse(FinanzasResponse):
    items: list[MovimientoCajaDetalleResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class GastoEntregaCreate(FinanzasInput):
    """Gasto confirmado por el encargado dentro de la transacción de entrega."""

    concepto: str = Field(min_length=1, max_length=300)
    monto: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    observaciones: str | None = None

    @field_validator("concepto")
    @classmethod
    def texto_normalizado(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El concepto no puede estar vacío")
        return value

    @field_validator("observaciones")
    @classmethod
    def observaciones_opcionales(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class CierreEmpleadoCreate(FinanzasInput):
    """Liquida pagos seleccionados por su saldo; no acepta identidad del receptor ni fechas."""

    id_sesion: int = Field(gt=0)
    id_empleado: int = Field(gt=0)
    clave_idempotencia: UUID
    ids_pagos: list[int] = Field(min_length=1, max_length=1000)
    monto_entregado: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    gastos: list[GastoEntregaCreate] = Field(default_factory=list, max_length=100)
    autorizar_gastos: bool = False
    observaciones: str | None = None

    @model_validator(mode="after")
    def validar_seleccion(self) -> Self:
        if any(identifier <= 0 for identifier in self.ids_pagos) or len(set(self.ids_pagos)) != len(self.ids_pagos):
            raise ValueError("Seleccione pagos únicos con identificadores positivos")
        if self.gastos and not self.autorizar_gastos:
            raise ValueError("El encargado debe confirmar expresamente los gastos")
        firmas = [(g.concepto, g.monto, g.observaciones) for g in self.gastos]
        if len(firmas) != len(set(firmas)):
            raise ValueError("No incluya el mismo gasto dos veces")
        self.observaciones = (self.observaciones or "").strip() or None
        return self
