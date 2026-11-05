"""Contratos de solo lectura para los reportes administrativos de Finanzas."""

from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.core.reportes import PeriodoReporte


class FilaReporteCobro(BaseModel):
    """Pago confirmado persistido, con su cliente, método y aplicaciones."""

    fecha: date
    cliente: str
    concepto: str
    metodo_pago: str
    referencia: str | None
    importe: Decimal


class ConceptoReporteCobro(BaseModel):
    """Importe aplicado agrupado por el concepto real del detalle de pago."""

    concepto: str
    importe: Decimal


class ReporteCobrosResponse(BaseModel):
    """Vista autoritativa de pagos confirmados, sin sumar dos veces el mismo ingreso."""

    tipo: Literal["cobros"] = "cobros"
    titulo: str
    periodo: PeriodoReporte
    periodo_descripcion: str
    fecha_inicio: date
    fecha_fin: date
    fecha_generacion: datetime
    usuario_generador: str
    total_pagos: int
    total_cobrado: Decimal
    conceptos: list[ConceptoReporteCobro]
    cobros: list[FilaReporteCobro]


class FilaReporteCaja(BaseModel):
    """Movimiento confirmado de Caja General con catálogos y responsable reales."""

    fecha: date
    hora: time
    tipo: Literal["Ingreso", "Egreso"]
    concepto: str
    metodo_pago: str | None
    referencia: str | None
    responsable: str
    importe: Decimal


class ReporteCajaResponse(BaseModel):
    """Saldo continuo de Caja General para el período solicitado."""

    tipo: Literal["caja"] = "caja"
    titulo: str
    periodo: PeriodoReporte
    periodo_descripcion: str
    fecha_inicio: date
    fecha_fin: date
    fecha_generacion: datetime
    usuario_generador: str
    total_movimientos: int
    saldo_inicial: Decimal
    entradas: Decimal
    salidas: Decimal
    saldo_esperado: Decimal
    movimientos: list[FilaReporteCaja]
