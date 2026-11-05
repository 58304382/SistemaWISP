"""Utilidades compartidas por los reportes administrativos de solo lectura.

Los reportes no persisten información: este módulo únicamente normaliza el
período solicitado para que los cinco documentos usen los mismos límites y la
misma descripción visible.
"""

from calendar import monthrange
from datetime import date, timedelta
from typing import Literal


PeriodoReporte = Literal["diario", "semanal", "mensual"]


def calcular_rango_reporte(
    periodo: PeriodoReporte, fecha_referencia: date
) -> tuple[date, date]:
    """Calcula límites inclusivos para día, semana lunes-domingo o mes."""

    if periodo == "diario":
        return fecha_referencia, fecha_referencia
    if periodo == "semanal":
        inicio = fecha_referencia - timedelta(days=fecha_referencia.weekday())
        return inicio, inicio + timedelta(days=6)
    ultimo_dia = monthrange(fecha_referencia.year, fecha_referencia.month)[1]
    return (
        fecha_referencia.replace(day=1),
        fecha_referencia.replace(day=ultimo_dia),
    )


def describir_periodo(fecha_inicio: date, fecha_fin: date) -> str:
    """Describe el rango en el formato ya utilizado por los reportes."""

    if fecha_inicio == fecha_fin:
        return fecha_inicio.strftime("%d/%m/%Y")
    return f"{fecha_inicio:%d/%m/%Y} al {fecha_fin:%d/%m/%Y}"
