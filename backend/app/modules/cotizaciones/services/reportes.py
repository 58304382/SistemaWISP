"""Consulta de solo lectura para el reporte administrativo de Cotizaciones."""

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.reportes import calcular_rango_reporte, describir_periodo
from app.modules.cotizaciones.models.cotizacion import Cotizacion
from app.modules.cotizaciones.schemas.reporte import PeriodoReporte
from app.modules.cotizaciones.services.cotizaciones import calcular_totales
from app.modules.ordenes_trabajo.models.orden_trabajo import EvaluacionOrden, OrdenTrabajo


# Una cotización COMPLETADA conserva la aceptación comercial que ya avanzó a
# Cobros; por eso integra el indicador de aceptadas junto con ACEPTADA.
ESTADOS_PENDIENTES = ("EN PROCESO", "GENERADA")
ESTADOS_ACEPTADOS = ("ACEPTADA", "COMPLETADA")


def _nombre_persona(persona) -> str:
    """Une nombres y apellidos sin introducir valores ficticios."""

    return f"{persona.nombres} {persona.apellidos}".strip()


def _origen_visible(cotizacion: Cotizacion) -> str:
    """Reproduce el origen presentado por Cotizaciones para órdenes de trabajo."""

    evaluacion = cotizacion.evaluacion_orden
    if (
        cotizacion.origen == "ORDEN_TRABAJO"
        and evaluacion is not None
        and evaluacion.orden is not None
        and evaluacion.orden.tipo_trabajo is not None
    ):
        return evaluacion.orden.tipo_trabajo.nombre
    return cotizacion.origen


def generar_reporte_cotizaciones(
    db: Session,
    periodo: PeriodoReporte,
    fecha_referencia: date,
    usuario_generador: str,
) -> dict:
    """Consulta cotizaciones reales y reutiliza calcular_totales para el importe."""

    fecha_inicio, fecha_fin = calcular_rango_reporte(periodo, fecha_referencia)
    query = (
        select(Cotizacion)
        .options(
            joinedload(Cotizacion.cliente),
            selectinload(Cotizacion.detalles),
            joinedload(Cotizacion.evaluacion_orden)
            .joinedload(EvaluacionOrden.orden)
            .joinedload(OrdenTrabajo.tipo_trabajo),
        )
        .where(
            Cotizacion.fecha >= fecha_inicio,
            Cotizacion.fecha <= fecha_fin,
        )
        .order_by(Cotizacion.fecha, Cotizacion.id_cotizacion)
    )
    cotizaciones = list(db.scalars(query).unique().all())

    pendientes = 0
    aceptadas = 0
    importe_total = Decimal("0.00")
    filas = []
    for cotizacion in cotizaciones:
        if cotizacion.estado in ESTADOS_PENDIENTES:
            pendientes += 1
        if cotizacion.estado in ESTADOS_ACEPTADOS:
            aceptadas += 1
        _, _, _, importe = calcular_totales(
            cotizacion.detalles, cotizacion.porcentaje_descuento
        )
        importe_total += importe
        filas.append(
            {
                "fecha": cotizacion.fecha,
                "cliente": _nombre_persona(cotizacion.cliente),
                "origen": _origen_visible(cotizacion),
                "estado": cotizacion.estado,
                "referencia": cotizacion.numero_cotizacion,
                "importe": importe,
            }
        )

    return {
        "tipo": "cotizaciones",
        "titulo": "Reporte de Cotizaciones y Proformas",
        "periodo": periodo,
        "periodo_descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "fecha_generacion": datetime.now(timezone.utc),
        "usuario_generador": usuario_generador,
        "total_cotizaciones": len(cotizaciones),
        "pendientes": pendientes,
        "aceptadas": aceptadas,
        "importe_total": importe_total,
        "cotizaciones": filas,
    }
