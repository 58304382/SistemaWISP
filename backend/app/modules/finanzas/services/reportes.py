"""Consultas de solo lectura para los reportes administrativos de Finanzas."""

from datetime import date, datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, joinedload

from app.core.reportes import calcular_rango_reporte, describir_periodo
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.caja import MovimientoCaja, SesionCaja
from app.modules.finanzas.models.cobros import MetodoPago, Pago, PagoDetalle
from app.modules.finanzas.schemas.reporte import PeriodoReporte


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
TIPO_INGRESO = "Ingreso"
TIPO_EGRESO = "Egreso"
SIN_CONCEPTO = "Sin concepto"
SIN_APLICAR = "Sin aplicar"


def _moneda(value: Decimal | int) -> Decimal:
    return Decimal(value).quantize(MONEDA, rounding=ROUND_HALF_UP)


def _nombre_persona(persona) -> str:
    """Une nombres y apellidos sin introducir valores ficticios."""

    return f"{persona.nombres} {persona.apellidos}".strip()


def _rango_datetime(fecha_inicio: date, fecha_fin: date) -> tuple[datetime, datetime]:
    """Convierte los límites inclusivos de fecha al rango persistido sin zona."""

    return (
        datetime.combine(fecha_inicio, time.min),
        datetime.combine(fecha_fin, time.max),
    )


def generar_reporte_cobros(
    db: Session,
    periodo: PeriodoReporte,
    fecha_referencia: date,
    usuario_generador: str,
) -> dict:
    """Lista únicamente pagos persistidos, que son los ingresos ya confirmados.

    No se consultan obligaciones pendientes ni se agrega el importe de un Pago
    al de su movimiento de Caja: cada pago confirmado se cuenta una sola vez.
    """

    fecha_inicio, fecha_fin = calcular_rango_reporte(periodo, fecha_referencia)
    inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    pagos = list(
        db.scalars(
            select(Pago)
            .options(joinedload(Pago.cliente), joinedload(Pago.metodo_pago))
            .where(Pago.fecha_hora >= inicio, Pago.fecha_hora <= fin)
            .order_by(Pago.fecha_hora, Pago.id_pago)
        )
        .unique()
        .all()
    )

    detalles_por_pago: dict[int, list[PagoDetalle]] = {}
    if pagos:
        detalles = db.scalars(
            select(PagoDetalle)
            .where(PagoDetalle.id_pago.in_([pago.id_pago for pago in pagos]))
            .order_by(PagoDetalle.id_pago, PagoDetalle.id_cobro)
        ).all()
        for detalle in detalles:
            detalles_por_pago.setdefault(detalle.id_pago, []).append(detalle)

    desglose: dict[str, Decimal] = {}
    total_cobrado = CERO
    filas = []
    for pago in pagos:
        detalles = detalles_por_pago.get(pago.id_pago, [])
        conceptos = {
            (detalle.concepto or "").strip() or SIN_CONCEPTO
            for detalle in detalles
        }
        monto = _moneda(pago.monto_total)
        total_cobrado += monto
        aplicado = CERO
        for detalle in detalles:
            concepto = (detalle.concepto or "").strip() or SIN_CONCEPTO
            aplicado += _moneda(detalle.monto_aplicado)
            desglose[concepto] = desglose.get(concepto, CERO) + _moneda(
                detalle.monto_aplicado
            )
        no_aplicado = _moneda(monto - aplicado)
        if no_aplicado > CERO:
            desglose[SIN_APLICAR] = desglose.get(SIN_APLICAR, CERO) + no_aplicado
        filas.append(
            {
                "fecha": pago.fecha_hora.date(),
                "cliente": _nombre_persona(pago.cliente),
                "concepto": ", ".join(sorted(conceptos)) or SIN_CONCEPTO,
                "metodo_pago": pago.metodo_pago.nombre,
                "referencia": pago.referencia,
                "importe": monto,
            }
        )

    return {
        "tipo": "cobros",
        "titulo": "Reporte de Cobros",
        "periodo": periodo,
        "periodo_descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "fecha_generacion": datetime.now(timezone.utc),
        "usuario_generador": usuario_generador,
        "total_pagos": len(pagos),
        "total_cobrado": _moneda(total_cobrado),
        "conceptos": [
            {"concepto": concepto, "importe": _moneda(importe)}
            for concepto, importe in desglose.items()
        ],
        "cobros": filas,
    }


def _saldo_inicial_periodo(
    db: Session, inicio: datetime, fin: datetime
) -> Decimal:
    """Obtiene el saldo de apertura del período sin duplicar el efectivo trasladado.

    Si una sesión ya estaba abierta al comenzar el período se usa su saldo inicial
    más los movimientos previos de esa sesión. Si el período comienza antes de la
    primera apertura se conserva el saldo inicial declarado por esa primera sesión,
    que es el valor mostrado por Caja General. Abrir una sesión posterior no se
    suma como ingreso: representa el mismo efectivo trasladado.
    """

    sesiones = list(
        db.scalars(
            select(SesionCaja).order_by(SesionCaja.fecha_apertura, SesionCaja.id_sesion)
        ).all()
    )
    for sesion in reversed(sesiones):
        if sesion.fecha_apertura <= inicio and (
            sesion.fecha_cierre is None or sesion.fecha_cierre >= inicio
        ):
            variacion = db.scalar(
                select(
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    MovimientoCaja.tipo == TIPO_INGRESO,
                                    MovimientoCaja.monto,
                                ),
                                (
                                    MovimientoCaja.tipo == TIPO_EGRESO,
                                    -MovimientoCaja.monto,
                                ),
                                else_=CERO,
                            )
                        ),
                        CERO,
                    )
                ).where(
                    MovimientoCaja.id_sesion == sesion.id_sesion,
                    MovimientoCaja.fecha_hora < inicio,
                )
            )
            return _moneda(
                _moneda(sesion.saldo_inicial) + _moneda(variacion or CERO)
            )

    del_periodo = [
        sesion
        for sesion in sesiones
        if inicio <= sesion.fecha_apertura <= fin
    ]
    if del_periodo:
        primera = min(
            del_periodo,
            key=lambda sesion: (sesion.fecha_apertura, sesion.id_sesion),
        )
        return _moneda(primera.saldo_inicial)

    cerradas = [
        sesion
        for sesion in sesiones
        if sesion.fecha_cierre is not None and sesion.fecha_cierre < inicio
    ]
    if not cerradas:
        return CERO
    ultima = max(
        cerradas, key=lambda sesion: (sesion.fecha_cierre, sesion.id_sesion)
    )
    return CERO if ultima.saldo_final is None else _moneda(ultima.saldo_final)


def generar_reporte_caja(
    db: Session,
    periodo: PeriodoReporte,
    fecha_referencia: date,
    usuario_generador: str,
) -> dict:
    """Resume movimientos persistidos y conserva el saldo continuo de Caja General.

    El saldo esperado replica el resumen general de Caja: saldo inicial más todas
    las entradas menos todas las salidas, sin restringir el método de pago.
    """

    fecha_inicio, fecha_fin = calcular_rango_reporte(periodo, fecha_referencia)
    inicio, fin = _rango_datetime(fecha_inicio, fecha_fin)
    saldo_inicial = _saldo_inicial_periodo(db, inicio, fin)

    rows = db.execute(
        select(MovimientoCaja, MetodoPago, Empleado)
        .outerjoin(MetodoPago, MetodoPago.id_metodo_pago == MovimientoCaja.id_metodo_pago)
        .join(Empleado, Empleado.id_empleado == MovimientoCaja.id_responsable)
        .where(MovimientoCaja.fecha_hora >= inicio, MovimientoCaja.fecha_hora <= fin)
        .order_by(MovimientoCaja.fecha_hora, MovimientoCaja.id_movimiento)
    ).all()

    entradas = CERO
    salidas = CERO
    filas = []
    for row in rows:
        movimiento = row.MovimientoCaja
        monto = _moneda(movimiento.monto)
        if movimiento.tipo == TIPO_INGRESO:
            entradas += monto
        elif movimiento.tipo == TIPO_EGRESO:
            salidas += monto
        filas.append(
            {
                "fecha": movimiento.fecha_hora.date(),
                "hora": movimiento.fecha_hora.time(),
                "tipo": movimiento.tipo,
                "concepto": movimiento.concepto,
                "metodo_pago": None if row.MetodoPago is None else row.MetodoPago.nombre,
                "referencia": movimiento.referencia,
                "responsable": _nombre_persona(row.Empleado),
                "importe": monto,
            }
        )

    entradas = _moneda(entradas)
    salidas = _moneda(salidas)
    return {
        "tipo": "caja",
        "titulo": "Reporte de Caja General",
        "periodo": periodo,
        "periodo_descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "fecha_generacion": datetime.now(timezone.utc),
        "usuario_generador": usuario_generador,
        "total_movimientos": len(rows),
        "saldo_inicial": saldo_inicial,
        "entradas": entradas,
        "salidas": salidas,
        "saldo_esperado": _moneda(saldo_inicial + entradas - salidas),
        "movimientos": filas,
    }
