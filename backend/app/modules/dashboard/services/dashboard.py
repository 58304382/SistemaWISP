"""Servicios de solo lectura del Dashboard Gerencial.

Reglas financieras principales:

- Los ingresos se obtienen únicamente de ``pagos`` (dinero confirmado).
- Los cobros aplicados se obtienen de ``pago_detalles``, que es la fuente
  existente para saber cuánto de cada pago cubrió una obligación.
- La cartera pendiente y la morosidad se calculan con el saldo real de
  ``cobros`` menos las aplicaciones de ``pago_detalles``.
- Caja General no se suma a los ingresos: sus movimientos de ingreso ya se
  originan en los pagos confirmados y sumarlos duplicaría el mismo dinero.
- Todas las consultas usan agregaciones en PostgreSQL; no se descargan
  listados completos para calcular los indicadores.
"""

from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import Date, cast, func, literal, select
from sqlalchemy.orm import Session

from app.core.reportes import calcular_rango_reporte, describir_periodo
from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, CotizacionDetalle
from app.modules.finanzas.models.cobros import Cobro, Pago, PagoDetalle
from app.modules.finanzas.services.cobros import _total_aplicado_subquery
from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.ordenes_trabajo.models.orden_trabajo import OrdenTrabajo
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.soporte_tecnico.models.ticket import Ticket
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
DIAS_SERIE_DIARIA = 62

ESTADOS_VISITA = ("Programada", "En Proceso", "Completada")
ESTADOS_INSTALACION = ("Programada", "En Proceso", "Completada")
ESTADOS_COTIZACION = (
    "EN PROCESO",
    "GENERADA",
    "ACEPTADA",
    "RECHAZADA",
    "COMPLETADA",
)
# El valor por defecto histórico de PostgreSQL para órdenes es "Pendiente";
# se conserva como estado observable sin alterar el catálogo real.
ESTADOS_ORDEN = ("Programada", "En Proceso", "Completada", "Pendiente")
ESTADOS_TICKET = ("Programada", "En Proceso", "Completada")

PERIODOS_REPORTE = {
    "hoy": "diario",
    "semana": "semanal",
    "mes": "mensual",
}


# ==========================================
# ERRORES DE VALIDACIÓN
# ==========================================
class PeriodoDashboardInvalidoError(ValueError):
    """El período solicitado no puede resolverse con fechas válidas."""


# ==========================================
# NORMALIZACIÓN DE PERÍODO
# ==========================================
def resolver_periodo(
    periodo: str,
    *,
    fecha_referencia: date | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
) -> tuple[date, date]:
    """Resuelve los filtros hoy, semana, mes y rango personalizado.

    La semana conserva el criterio lunes-domingo ya utilizado por los reportes
    administrativos. El rango personalizado exige ambas fechas y un orden
    inclusivo válido.
    """

    referencia = fecha_referencia or date.today()
    if periodo in PERIODOS_REPORTE:
        return calcular_rango_reporte(PERIODOS_REPORTE[periodo], referencia)
    if periodo == "personalizado":
        if fecha_inicio is None or fecha_fin is None:
            raise PeriodoDashboardInvalidoError(
                "El rango personalizado requiere fecha_inicio y fecha_fin"
            )
        if fecha_inicio > fecha_fin:
            raise PeriodoDashboardInvalidoError(
                "fecha_inicio no puede ser posterior a fecha_fin"
            )
        return fecha_inicio, fecha_fin
    raise PeriodoDashboardInvalidoError("El período solicitado no es válido")


def granularidad_serie(fecha_inicio: date, fecha_fin: date) -> str:
    """Evita series diarias innecesariamente largas en rangos personalizados."""

    dias = (fecha_fin - fecha_inicio).days
    return "diaria" if dias <= DIAS_SERIE_DIARIA else "mensual"


def _periodo_response(fecha_inicio: date, fecha_fin: date, periodo: str) -> dict[str, Any]:
    return {
        "tipo": periodo,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "granularidad": granularidad_serie(fecha_inicio, fecha_fin),
    }


def _rango_datetime(fecha_inicio: date, fecha_fin: date) -> tuple[datetime, datetime]:
    """Convierte fechas inclusivas al rango sin zona usado por los pagos."""

    return (
        datetime.combine(fecha_inicio, time.min),
        datetime.combine(fecha_fin, time.max),
    )


def _moneda(value: Decimal | int | None) -> Decimal:
    return Decimal(value or 0).quantize(MONEDA, rounding=ROUND_HALF_UP)


# ==========================================
# AGREGADOS FINANCIEROS
# ==========================================
def _ingresos_por_origen(
    db: Session, inicio: datetime, fin: datetime
) -> list[tuple[str, Any, int]]:
    """Suma pagos confirmados una sola vez, sin consultar Caja General."""

    return list(
        db.execute(
            select(
                Pago.origen_financiero,
                func.coalesce(func.sum(Pago.monto_total), CERO),
                func.count(Pago.id_pago),
            )
            .where(Pago.fecha_hora >= inicio, Pago.fecha_hora <= fin)
            .group_by(Pago.origen_financiero)
        ).all()
    )


def _cobros_aplicados_por_origen(
    db: Session, inicio: datetime, fin: datetime
) -> list[tuple[str, Any, int]]:
    """Suma las aplicaciones de pago, no el total del pago otra vez."""

    return list(
        db.execute(
            select(
                PagoDetalle.origen_financiero,
                func.coalesce(func.sum(PagoDetalle.monto_aplicado), CERO),
                func.count(PagoDetalle.id_cobro),
            )
            .join(Pago, Pago.id_pago == PagoDetalle.id_pago)
            .where(Pago.fecha_hora >= inicio, Pago.fecha_hora <= fin)
            .group_by(PagoDetalle.origen_financiero)
        ).all()
    )


def _cartera_por_origen(
    db: Session,
    fecha_fin: date,
    *,
    solo_vencidos: bool = False,
) -> list[tuple[str, Any, int]]:
    """Agrupa saldos positivos de cobros; nunca oculta sobrepagos como cero."""

    total_aplicado = _total_aplicado_subquery()
    saldo = Cobro.monto - total_aplicado
    query = (
        select(
            Cobro.origen_financiero,
            func.coalesce(func.sum(saldo), CERO),
            func.count(Cobro.id_cobro),
        )
        .where(
            saldo > 0,
            Cobro.fecha_emision <= fecha_fin,
        )
        .group_by(Cobro.origen_financiero)
    )
    if solo_vencidos:
        query = query.where(
            Cobro.fecha_vencimiento.is_not(None),
            Cobro.fecha_vencimiento < fecha_fin,
        )
    return list(db.execute(query).all())


def _agregado_por_origen(
    rows: list[tuple[str, Any, int]],
) -> tuple[Decimal, int, list[dict[str, Any]]]:
    """Normaliza filas SQL y calcula totales sin descargar las entidades."""

    total = CERO
    cantidad = 0
    items: list[dict[str, Any]] = []
    for origen, monto, documentos in rows:
        monto_normalizado = _moneda(monto)
        documentos_normalizados = int(documentos or 0)
        total += monto_normalizado
        cantidad += documentos_normalizados
        items.append(
            {
                "origen": origen or "SIN_ORIGEN",
                "monto": monto_normalizado,
                "cantidad": documentos_normalizados,
            }
        )
    items.sort(key=lambda item: item["origen"])
    return _moneda(total), cantidad, items


def calcular_indicadores_financieros(
    db: Session, fecha_inicio: date, fecha_fin: date
) -> dict[str, Any]:
    """Construye ingresos, cobros, cartera y morosidad del período."""

    inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    ingresos_total, _, ingresos_origen = _agregado_por_origen(
        _ingresos_por_origen(db, inicio, fin)
    )
    cobros_total, _, _ = _agregado_por_origen(
        _cobros_aplicados_por_origen(db, inicio, fin)
    )
    cartera_total, cartera_documentos, cartera_origen = _agregado_por_origen(
        _cartera_por_origen(db, fecha_fin)
    )
    morosidad_total, morosidad_documentos, morosidad_origen = _agregado_por_origen(
        _cartera_por_origen(db, fecha_fin, solo_vencidos=True)
    )
    return {
        "ingresos": ingresos_total,
        "cobros_aplicados": cobros_total,
        "cartera_pendiente": cartera_total,
        "documentos_pendientes": cartera_documentos,
        "morosidad_monto": morosidad_total,
        "documentos_vencidos": morosidad_documentos,
        "ingresos_por_origen": ingresos_origen,
        "cartera_por_origen": cartera_origen,
        "morosidad_por_origen": morosidad_origen,
    }


# ==========================================
# CONTEOS POR ESTADO
# ==========================================
def _filtro_fecha(column, fecha_inicio: date, fecha_fin: date, *, datetime_col: bool):
    if datetime_col:
        inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    else:
        inicio, fin = fecha_inicio, fecha_fin
    return column >= inicio, column <= fin


def _conteo_estados(
    db: Session,
    column_estado,
    column_fecha,
    fecha_inicio: date,
    fecha_fin: date,
    estados_esperados: tuple[str, ...],
    *,
    datetime_col: bool = False,
) -> dict[str, Any]:
    """Cuenta por estado en PostgreSQL y completa con cero los estados conocidos."""

    filtros = _filtro_fecha(
        column_fecha, fecha_inicio, fecha_fin, datetime_col=datetime_col
    )
    rows = db.execute(
        select(column_estado, func.count())
        .where(*filtros)
        .group_by(column_estado)
    ).all()
    conteos = {estado: 0 for estado in estados_esperados}
    for estado, cantidad in rows:
        conteos[estado or "Sin estado"] = int(cantidad or 0)
    return {
        "total": sum(conteos.values()),
        "por_estado": [
            {"estado": estado, "cantidad": cantidad}
            for estado, cantidad in conteos.items()
        ],
    }


def _conteo_modulo(
    db: Session,
    model,
    column_estado,
    column_fecha,
    fecha_inicio: date,
    fecha_fin: date,
    estados_esperados: tuple[str, ...],
    *,
    datetime_col: bool = False,
) -> dict[str, Any]:
    return _conteo_estados(
        db,
        column_estado,
        column_fecha,
        fecha_inicio,
        fecha_fin,
        estados_esperados,
        datetime_col=datetime_col,
    )


# ==========================================
# CLIENTES Y SERVICIOS
# ==========================================
def calcular_indicadores_clientes(db: Session) -> dict[str, Any]:
    """Cuenta clientes reales por estado sin traer sus registros completos."""

    rows = db.execute(
        select(Cliente.estado, func.count()).group_by(Cliente.estado)
    ).all()
    conteos: dict[str, int] = {}
    for estado, cantidad in rows:
        conteos[estado or "Sin estado"] = int(cantidad or 0)
    total = sum(conteos.values())
    return {
        "total": total,
        "activos": conteos.get("Activo", 0),
        "inactivos": conteos.get("Inactivo", 0),
        "por_estado": [
            {"estado": estado, "cantidad": cantidad}
            for estado, cantidad in sorted(conteos.items())
        ],
    }


def calcular_indicadores_servicios(db: Session) -> dict[str, Any]:
    """Resume asignaciones de Internet y el valor mensual realmente contratado."""

    rows = db.execute(
        select(
            ServicioAsignacionPlan.estado,
            func.count(ServicioAsignacionPlan.id_asignacion),
            func.coalesce(func.sum(ServicioAsignacionPlan.costo_mensual), CERO),
            func.count(func.distinct(ServicioAsignacionPlan.id_cliente)),
        ).group_by(ServicioAsignacionPlan.estado)
    ).all()
    conteos: dict[str, int] = {}
    facturacion_activa = CERO
    clientes_activos = 0
    for estado, cantidad, costo, clientes in rows:
        estado_normalizado = estado or "Sin estado"
        cantidad_normalizada = int(cantidad or 0)
        conteos[estado_normalizado] = cantidad_normalizada
        if estado_normalizado == "Activo":
            facturacion_activa += _moneda(costo)
            clientes_activos += int(clientes or 0)
    return {
        "total": sum(conteos.values()),
        "activos": conteos.get("Activo", 0),
        "inactivos": conteos.get("Inactivo", 0),
        "por_estado": [
            {"estado": estado, "cantidad": cantidad}
            for estado, cantidad in sorted(conteos.items())
        ],
        "clientes_con_servicio_activo": clientes_activos,
        "ingreso_mensual_contratado": _moneda(facturacion_activa),
    }


def calcular_indicadores_operativos(
    db: Session, fecha_inicio: date, fecha_fin: date
) -> dict[str, Any]:
    """Cuenta por estado los cinco módulos operativos del negocio."""

    return {
        "visitas_tecnicas": _conteo_modulo(
            db,
            VisitaTecnica,
            VisitaTecnica.estado,
            VisitaTecnica.fecha_programada,
            fecha_inicio,
            fecha_fin,
            ESTADOS_VISITA,
        ),
        "instalaciones": _conteo_modulo(
            db,
            Instalacion,
            Instalacion.estado,
            Instalacion.fecha_programada,
            fecha_inicio,
            fecha_fin,
            ESTADOS_INSTALACION,
        ),
        "cotizaciones": _conteo_modulo(
            db,
            Cotizacion,
            Cotizacion.estado,
            Cotizacion.fecha,
            fecha_inicio,
            fecha_fin,
            ESTADOS_COTIZACION,
        ),
        "ordenes_trabajo": _conteo_modulo(
            db,
            OrdenTrabajo,
            OrdenTrabajo.estado,
            OrdenTrabajo.fecha_recepcion,
            fecha_inicio,
            fecha_fin,
            ESTADOS_ORDEN,
            datetime_col=True,
        ),
        "tickets": _conteo_modulo(
            db,
            Ticket,
            Ticket.estado,
            Ticket.fecha_apertura,
            fecha_inicio,
            fecha_fin,
            ESTADOS_TICKET,
            datetime_col=True,
        ),
    }


# ==========================================
# SERIES PARA GRÁFICAS
# ==========================================
def _bucket_expr(column, granularidad: str):
    """Agrupa por fecha diaria o por primer día del mes en PostgreSQL."""

    if granularidad == "mensual":
        return func.date_trunc("month", column)
    return cast(column, Date)


def _fecha_bucket(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _siguiente_mes(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _fechas_serie(
    fecha_inicio: date, fecha_fin: date, granularidad: str
) -> list[date]:
    """Genera los buckets consecutivos para devolver series con ceros."""

    actual = fecha_inicio if granularidad == "diaria" else fecha_inicio.replace(day=1)
    fechas: list[date] = []
    while actual <= fecha_fin:
        fechas.append(actual)
        actual = (
            actual + timedelta(days=1)
            if granularidad == "diaria"
            else _siguiente_mes(actual)
        )
    return fechas


def _serie_monto(
    rows: list[tuple[Any, Any]],
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    valores = {_fecha_bucket(fecha): _moneda(monto) for fecha, monto in rows}
    return [
        {"fecha": fecha, "monto": valores.get(fecha, CERO)}
        for fecha in _fechas_serie(fecha_inicio, fecha_fin, granularidad)
    ]


def _serie_cantidad(
    rows: list[tuple[Any, Any]],
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    valores = {_fecha_bucket(fecha): int(cantidad or 0) for fecha, cantidad in rows}
    return [
        {"fecha": fecha, "cantidad": valores.get(fecha, 0)}
        for fecha in _fechas_serie(fecha_inicio, fecha_fin, granularidad)
    ]


def _serie_ingresos(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    bucket = _bucket_expr(Pago.fecha_hora, granularidad)
    rows = db.execute(
        select(bucket.label("bucket"), func.coalesce(func.sum(Pago.monto_total), CERO))
        .where(Pago.fecha_hora >= inicio, Pago.fecha_hora <= fin)
        .group_by(bucket)
    ).all()
    return _serie_monto(rows, fecha_inicio, fecha_fin, granularidad)


def _serie_cobros_aplicados(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    bucket = _bucket_expr(Pago.fecha_hora, granularidad)
    rows = db.execute(
        select(
            bucket.label("bucket"),
            func.coalesce(func.sum(PagoDetalle.monto_aplicado), CERO),
        )
        .join(Pago, Pago.id_pago == PagoDetalle.id_pago)
        .where(Pago.fecha_hora >= inicio, Pago.fecha_hora <= fin)
        .group_by(bucket)
    ).all()
    return _serie_monto(rows, fecha_inicio, fecha_fin, granularidad)


def _serie_cartera_vencimiento(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    total_aplicado = _total_aplicado_subquery()
    saldo = Cobro.monto - total_aplicado
    bucket = _bucket_expr(Cobro.fecha_vencimiento, granularidad)
    rows = db.execute(
        select(
            bucket.label("bucket"),
            func.coalesce(func.sum(saldo), CERO),
            func.count(Cobro.id_cobro),
        )
        .where(
            saldo > 0,
            Cobro.fecha_vencimiento.is_not(None),
            Cobro.fecha_vencimiento >= fecha_inicio,
            Cobro.fecha_vencimiento <= fecha_fin,
            Cobro.fecha_emision <= fecha_fin,
        )
        .group_by(bucket)
    ).all()
    valores = {
        _fecha_bucket(fecha): {
            "monto": _moneda(monto),
            "documentos": int(documentos or 0),
        }
        for fecha, monto, documentos in rows
    }
    return [
        {
            "fecha": fecha,
            "monto": valores.get(fecha, {}).get("monto", CERO),
            "documentos": valores.get(fecha, {}).get("documentos", 0),
        }
        for fecha in _fechas_serie(fecha_inicio, fecha_fin, granularidad)
    ]


def calcular_series_financieras(
    db: Session, fecha_inicio: date, fecha_fin: date, granularidad: str
) -> dict[str, Any]:
    return {
        "ingresos": _serie_ingresos(db, fecha_inicio, fecha_fin, granularidad),
        "cobros_aplicados": _serie_cobros_aplicados(
            db, fecha_inicio, fecha_fin, granularidad
        ),
        "cartera_por_vencimiento": _serie_cartera_vencimiento(
            db, fecha_inicio, fecha_fin, granularidad
        ),
    }


def _serie_cotizaciones(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    bucket = _bucket_expr(Cotizacion.fecha, granularidad)
    rows = db.execute(
        select(bucket.label("bucket"), func.count())
        .where(Cotizacion.fecha >= fecha_inicio, Cotizacion.fecha <= fecha_fin)
        .group_by(bucket)
    ).all()
    return _serie_cantidad(rows, fecha_inicio, fecha_fin, granularidad)


def _serie_importe_cotizado(
    db: Session,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
) -> list[dict[str, Any]]:
    """Calcula el importe con la misma fórmula de Cotizaciones en una agregación.

    Primero se obtiene el subtotal de cada cotización para aplicar su descuento
    una sola vez; luego PostgreSQL suma por bucket.
    """

    subtotales = (
        select(
            CotizacionDetalle.id_cotizacion.label("id_cotizacion"),
            func.coalesce(
                func.sum(
                    CotizacionDetalle.cantidad
                    * func.coalesce(CotizacionDetalle.precio_unitario, CERO)
                ),
                CERO,
            ).label("subtotal"),
        )
        .group_by(CotizacionDetalle.id_cotizacion)
        .subquery()
    )
    importe = subtotales.c.subtotal * (
        literal(1) - Cotizacion.porcentaje_descuento / literal(100)
    )
    bucket = _bucket_expr(Cotizacion.fecha, granularidad)
    rows = db.execute(
        select(bucket.label("bucket"), func.coalesce(func.sum(importe), CERO))
        .outerjoin(
            subtotales,
            subtotales.c.id_cotizacion == Cotizacion.id_cotizacion,
        )
        .where(Cotizacion.fecha >= fecha_inicio, Cotizacion.fecha <= fecha_fin)
        .group_by(bucket)
    ).all()
    return _serie_monto(rows, fecha_inicio, fecha_fin, granularidad)


def calcular_series_comerciales(
    db: Session, fecha_inicio: date, fecha_fin: date, granularidad: str
) -> dict[str, Any]:
    return {
        "cotizaciones": _serie_cotizaciones(
            db, fecha_inicio, fecha_fin, granularidad
        ),
        "importe_cotizado": _serie_importe_cotizado(
            db, fecha_inicio, fecha_fin, granularidad
        ),
    }


def _serie_modulo(
    db: Session,
    column_fecha,
    fecha_inicio: date,
    fecha_fin: date,
    granularidad: str,
    *,
    datetime_col: bool = False,
) -> list[dict[str, Any]]:
    filtros = _filtro_fecha(
        column_fecha, fecha_inicio, fecha_fin, datetime_col=datetime_col
    )
    bucket = _bucket_expr(column_fecha, granularidad)
    rows = db.execute(
        select(bucket.label("bucket"), func.count())
        .where(*filtros)
        .group_by(bucket)
    ).all()
    return _serie_cantidad(rows, fecha_inicio, fecha_fin, granularidad)


def calcular_series_operativas(
    db: Session, fecha_inicio: date, fecha_fin: date, granularidad: str
) -> dict[str, Any]:
    return {
        "visitas_tecnicas": _serie_modulo(
            db,
            VisitaTecnica.fecha_programada,
            fecha_inicio,
            fecha_fin,
            granularidad,
        ),
        "instalaciones": _serie_modulo(
            db,
            Instalacion.fecha_programada,
            fecha_inicio,
            fecha_fin,
            granularidad,
        ),
        "cotizaciones": _serie_modulo(
            db,
            Cotizacion.fecha,
            fecha_inicio,
            fecha_fin,
            granularidad,
        ),
        "ordenes_trabajo": _serie_modulo(
            db,
            OrdenTrabajo.fecha_recepcion,
            fecha_inicio,
            fecha_fin,
            granularidad,
            datetime_col=True,
        ),
        "tickets": _serie_modulo(
            db,
            Ticket.fecha_apertura,
            fecha_inicio,
            fecha_fin,
            granularidad,
            datetime_col=True,
        ),
    }


# ==========================================
# RESPUESTAS CONSOLIDADAS
# ==========================================
def obtener_resumen(
    db: Session,
    periodo: str,
    *,
    fecha_referencia: date | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
) -> dict[str, Any]:
    inicio, fin = resolver_periodo(
        periodo,
        fecha_referencia=fecha_referencia,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )
    return {
        "periodo": _periodo_response(inicio, fin, periodo),
        "generado_en": datetime.now(timezone.utc),
        "financiero": calcular_indicadores_financieros(db, inicio, fin),
        "clientes": calcular_indicadores_clientes(db),
        "servicios": calcular_indicadores_servicios(db),
        "operativo": calcular_indicadores_operativos(db, inicio, fin),
    }


def obtener_dashboard_financiero(
    db: Session,
    periodo: str,
    *,
    fecha_referencia: date | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
) -> dict[str, Any]:
    inicio, fin = resolver_periodo(
        periodo,
        fecha_referencia=fecha_referencia,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )
    periodo_response = _periodo_response(inicio, fin, periodo)
    return {
        "periodo": periodo_response,
        "generado_en": datetime.now(timezone.utc),
        "indicadores": calcular_indicadores_financieros(db, inicio, fin),
        "series": calcular_series_financieras(
            db, inicio, fin, periodo_response["granularidad"]
        ),
    }


def obtener_dashboard_comercial(
    db: Session,
    periodo: str,
    *,
    fecha_referencia: date | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
) -> dict[str, Any]:
    inicio, fin = resolver_periodo(
        periodo,
        fecha_referencia=fecha_referencia,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )
    periodo_response = _periodo_response(inicio, fin, periodo)
    return {
        "periodo": periodo_response,
        "generado_en": datetime.now(timezone.utc),
        "clientes": calcular_indicadores_clientes(db),
        "servicios": calcular_indicadores_servicios(db),
        "cotizaciones": _conteo_modulo(
            db,
            Cotizacion,
            Cotizacion.estado,
            Cotizacion.fecha,
            inicio,
            fin,
            ESTADOS_COTIZACION,
        ),
        "series": calcular_series_comerciales(
            db, inicio, fin, periodo_response["granularidad"]
        ),
    }


def obtener_dashboard_operativo(
    db: Session,
    periodo: str,
    *,
    fecha_referencia: date | None = None,
    fecha_inicio: date | None = None,
    fecha_fin: date | None = None,
) -> dict[str, Any]:
    inicio, fin = resolver_periodo(
        periodo,
        fecha_referencia=fecha_referencia,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )
    periodo_response = _periodo_response(inicio, fin, periodo)
    return {
        "periodo": periodo_response,
        "generado_en": datetime.now(timezone.utc),
        "operativo": calcular_indicadores_operativos(db, inicio, fin),
        "series": calcular_series_operativas(
            db, inicio, fin, periodo_response["granularidad"]
        ),
    }
