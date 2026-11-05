"""Contratos de solo lectura del Dashboard Gerencial.

Los esquemas no representan tablas nuevas: describen exclusivamente las
respuestas calculadas por FastAPI a partir de la información ya persistida en
PostgreSQL.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


# ==========================================
# TIPOS DE FILTRO Y SERIES
# ==========================================
PeriodoDashboard = Literal["hoy", "semana", "mes", "personalizado"]
GranularidadSerie = Literal["diaria", "mensual"]


# ==========================================
# PERÍODO CONSULTADO
# ==========================================
class PeriodoDashboardResponse(BaseModel):
    """Rango inclusivo resuelto y granularidad usada por las series."""

    tipo: PeriodoDashboard
    fecha_inicio: date
    fecha_fin: date
    descripcion: str
    granularidad: GranularidadSerie


# ==========================================
# INDICADORES FINANCIEROS
# ==========================================
class MontoPorOrigen(BaseModel):
    """Importe y cantidad de documentos agrupados por origen financiero."""

    origen: str
    monto: Decimal
    cantidad: int


class IndicadoresFinancieros(BaseModel):
    """Consolidado financiero calculado sin sumar Caja General a los Pagos."""

    ingresos: Decimal
    cobros_aplicados: Decimal
    cartera_pendiente: Decimal
    documentos_pendientes: int
    morosidad_monto: Decimal
    documentos_vencidos: int
    ingresos_por_origen: list[MontoPorOrigen]
    cartera_por_origen: list[MontoPorOrigen]
    morosidad_por_origen: list[MontoPorOrigen]


# ==========================================
# CONTEOS OPERATIVOS Y COMERCIALES
# ==========================================
class ConteoPorEstado(BaseModel):
    """Cantidad real de registros para un estado del dominio."""

    estado: str
    cantidad: int


class ConteoModulo(BaseModel):
    """Total y desglose por estado de un módulo operativo."""

    total: int
    por_estado: list[ConteoPorEstado]


class IndicadoresClientes(BaseModel):
    """Cantidad de clientes registrados y su distribución por estado."""

    total: int
    activos: int
    inactivos: int
    por_estado: list[ConteoPorEstado]


class IndicadoresServicios(BaseModel):
    """Servicios de Internet asignados, activos y su valor mensual contratado."""

    total: int
    activos: int
    inactivos: int
    por_estado: list[ConteoPorEstado]
    clientes_con_servicio_activo: int
    ingreso_mensual_contratado: Decimal


class IndicadoresOperativos(BaseModel):
    """Conteos por estado de visitas, instalaciones, cotizaciones, órdenes y tickets."""

    visitas_tecnicas: ConteoModulo
    instalaciones: ConteoModulo
    cotizaciones: ConteoModulo
    ordenes_trabajo: ConteoModulo
    tickets: ConteoModulo


# ==========================================
# SERIES PARA GRÁFICAS
# ==========================================
class PuntoSerieMonto(BaseModel):
    """Punto de una serie financiera o comercial expresado en moneda."""

    fecha: date
    monto: Decimal


class PuntoSerieCantidad(BaseModel):
    """Punto de una serie operativa expresado en cantidad de registros."""

    fecha: date
    cantidad: int


class PuntoSerieCartera(BaseModel):
    """Cartera pendiente agrupada por fecha de vencimiento."""

    fecha: date
    monto: Decimal
    documentos: int


class SeriesFinancieras(BaseModel):
    """Series diarias o mensuales construidas desde Pagos y obligaciones."""

    ingresos: list[PuntoSerieMonto]
    cobros_aplicados: list[PuntoSerieMonto]
    cartera_por_vencimiento: list[PuntoSerieCartera]


class SeriesComerciales(BaseModel):
    """Series de cotizaciones emitidas y su importe calculado."""

    cotizaciones: list[PuntoSerieCantidad]
    importe_cotizado: list[PuntoSerieMonto]


class SeriesOperativas(BaseModel):
    """Series de registros creados o programados por módulo operativo."""

    visitas_tecnicas: list[PuntoSerieCantidad]
    instalaciones: list[PuntoSerieCantidad]
    cotizaciones: list[PuntoSerieCantidad]
    ordenes_trabajo: list[PuntoSerieCantidad]
    tickets: list[PuntoSerieCantidad]


# ==========================================
# RESPUESTAS DE LOS ENDPOINTS
# ==========================================
class ResumenDashboardResponse(BaseModel):
    """Vista consolidada del negocio para el Dashboard Gerencial."""

    periodo: PeriodoDashboardResponse
    generado_en: datetime
    financiero: IndicadoresFinancieros
    clientes: IndicadoresClientes
    servicios: IndicadoresServicios
    operativo: IndicadoresOperativos


class DashboardFinancieroResponse(BaseModel):
    """Indicadores financieros y series para gráficas de ingresos y cartera."""

    periodo: PeriodoDashboardResponse
    generado_en: datetime
    indicadores: IndicadoresFinancieros
    series: SeriesFinancieras


class DashboardComercialResponse(BaseModel):
    """Clientes, servicios y series comerciales del período consultado."""

    periodo: PeriodoDashboardResponse
    generado_en: datetime
    clientes: IndicadoresClientes
    servicios: IndicadoresServicios
    cotizaciones: ConteoModulo
    series: SeriesComerciales


class DashboardOperativoResponse(BaseModel):
    """Conteos y series operativas del período consultado."""

    periodo: PeriodoDashboardResponse
    generado_en: datetime
    operativo: IndicadoresOperativos
    series: SeriesOperativas
