"""Contratos de solo lectura para el reporte administrativo de Cotizaciones."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.core.reportes import PeriodoReporte
from app.modules.cotizaciones.schemas.cotizacion import EstadoCotizacion


class FilaReporteCotizacion(BaseModel):
    """Una fila por cotización, sin duplicar proformas que la referencian."""

    fecha: date
    cliente: str
    origen: str
    estado: EstadoCotizacion
    referencia: str
    importe: Decimal


class ReporteCotizacionesResponse(BaseModel):
    """Vista autoritativa del reporte generado por FastAPI."""

    tipo: Literal["cotizaciones"] = "cotizaciones"
    titulo: str
    periodo: PeriodoReporte
    periodo_descripcion: str
    fecha_inicio: date
    fecha_fin: date
    fecha_generacion: datetime
    usuario_generador: str
    total_cotizaciones: int
    pendientes: int
    aceptadas: int
    importe_total: Decimal
    cotizaciones: list[FilaReporteCotizacion]
