"""Contratos de solo lectura para el reporte administrativo de Soporte Técnico."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.core.reportes import PeriodoReporte
from app.modules.soporte_tecnico.schemas.ticket import EstadoTicket


class FilaReporteSoporte(BaseModel):
    """Ticket con el resultado registrado en su historial de finalización."""

    fecha: date
    cliente: str
    categoria: str | None
    tecnico: str | None
    estado: EstadoTicket
    resultado: str | None


class ReporteSoporteResponse(BaseModel):
    """Vista autoritativa del reporte generado por FastAPI."""

    tipo: Literal["soporte"] = "soporte"
    titulo: str
    periodo: PeriodoReporte
    periodo_descripcion: str
    fecha_inicio: date
    fecha_fin: date
    fecha_generacion: datetime
    usuario_generador: str
    total_tickets: int
    programados: int
    en_proceso: int
    completados: int
    tickets: list[FilaReporteSoporte]
