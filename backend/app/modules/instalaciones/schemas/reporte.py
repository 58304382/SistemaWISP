"""Contratos de solo lectura para el reporte administrativo de instalaciones."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.instalaciones.schemas.instalacion import EstadoInstalacion


PeriodoReporteInstalaciones = Literal["diario", "semanal", "mensual"]


class EstadoReporteInstalaciones(BaseModel):
    """Cantidad de instalaciones para uno de los estados reales del módulo."""

    estado: EstadoInstalacion
    cantidad: int


class FilaReporteInstalacion(BaseModel):
    """Datos existentes que componen una fila del reporte."""

    fecha: date
    cliente: str
    tipo_instalacion: str | None
    tecnico_responsable: str | None
    estado: EstadoInstalacion
    observaciones: str | None


class ReporteInstalacionesResponse(BaseModel):
    """Vista autoritativa del reporte generado por FastAPI."""

    titulo: str
    periodo: PeriodoReporteInstalaciones
    periodo_descripcion: str
    fecha_inicio: date
    fecha_fin: date
    fecha_generacion: datetime
    usuario_generador: str
    total_instalaciones: int
    estados: list[EstadoReporteInstalaciones]
    instalaciones: list[FilaReporteInstalacion]
