"""Integracion financiera de Ordenes de Trabajo con Cobros.

La relacion persistente requiere la migracion 009. Mientras no este aplicada,
las operaciones de pago de ordenes se bloquean con un error explicito y el
resto de origenes financieros continua funcionando sin cambios.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import and_, func, select, text
from sqlalchemy.orm import Session, joinedload, selectinload, undefer

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, Proforma
from app.modules.cotizaciones.services.cotizaciones import calcular_totales
from app.modules.finanzas.models.cobros import Cobro, PagoDetalle
from app.modules.ordenes_trabajo.models.orden_trabajo import (
    EvaluacionOrden,
    OrdenTrabajo,
)


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
ORIGEN_ORDENES = "ORDENES_TRABAJO"


class MigracionOrdenesTrabajoPendienteError(Exception):
    """La migracion 009 aun no relaciona cobros con ordenes de trabajo."""


class CotizacionOrdenNoEncontradaError(Exception):
    """La cotizacion de orden no existe o no pertenece al cliente."""


class CotizacionOrdenInvalidaError(Exception):
    """La cotizacion no tiene documento comercial valido para cobro."""


class OrdenCobroInconsistenteError(Exception):
    """La obligacion existente no coincide con la cotizacion de la orden."""


def _moneda(value: Decimal | int) -> Decimal:
    return Decimal(value).quantize(MONEDA, rounding=ROUND_HALF_UP)


def _nombre_cliente(cliente: Cliente | None, id_cliente: int) -> str:
    if cliente is None:
        return f"Cliente #{id_cliente}"
    nombre = " ".join(
        parte.strip()
        for parte in (cliente.nombres, cliente.apellidos)
        if parte and parte.strip()
    )
    return nombre or f"Cliente #{id_cliente}"


def migracion_ordenes_trabajo_aplicada(db: Session) -> bool:
    """Comprueba si existe la columna que relaciona Cobros con Ordenes."""

    return bool(
        db.scalar(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'cobros'
                      AND column_name = 'id_orden_trabajo'
                )
                """
            )
        )
    )


def _requerir_migracion(db: Session) -> None:
    if not migracion_ordenes_trabajo_aplicada(db):
        raise MigracionOrdenesTrabajoPendienteError


def _total_cotizacion(cotizacion: Cotizacion) -> Decimal:
    """Reutiliza el calculo real de Cotizaciones, incluidos descuentos."""

    _, _, _, total = calcular_totales(
        cotizacion.detalles,
        cotizacion.porcentaje_descuento,
    )
    return _moneda(total)


def _query_cotizaciones_orden(
    id_cliente: int | None = None,
    *,
    solo_aceptadas: bool = True,
):
    query = (
        select(Cotizacion, Proforma, OrdenTrabajo)
        .join(
            EvaluacionOrden,
            EvaluacionOrden.id_evaluacion == Cotizacion.id_evaluacion_orden,
        )
        .join(
            OrdenTrabajo,
            OrdenTrabajo.id_orden == EvaluacionOrden.id_orden,
        )
        .join(
            Proforma,
            Proforma.id_cotizacion == Cotizacion.id_cotizacion,
        )
        .options(
            selectinload(Cotizacion.detalles),
            joinedload(Cotizacion.cliente),
        )
        .where(Cotizacion.origen == "ORDEN_TRABAJO")
    )
    if solo_aceptadas:
        query = query.where(
            Cotizacion.estado.in_(("ACEPTADA", "COMPLETADA")),
        )
    if id_cliente is not None:
        query = query.where(Cotizacion.id_cliente == id_cliente)
    return query


def listar_cotizaciones_orden(
    db: Session,
    id_cliente: int,
) -> list[dict[str, Any]]:
    """Lista cotizaciones cobrables con proforma y saldo real pendiente."""

    _requerir_migracion(db)
    rows = db.execute(
        _query_cotizaciones_orden(id_cliente).order_by(
            OrdenTrabajo.fecha_recepcion.desc(),
            Cotizacion.id_cotizacion.desc(),
        )
    ).unique().all()
    if not rows:
        return []

    ordenes = {row.OrdenTrabajo.id_orden: row for row in rows}
    cobros = list(
        db.scalars(
            select(Cobro)
            .options(undefer(Cobro.id_orden_trabajo))
            .where(Cobro.id_orden_trabajo.in_(list(ordenes)))
            .order_by(Cobro.id_cobro)
        ).all()
    )
    cobros_por_orden: dict[int, Cobro] = {}
    for cobro in cobros:
        if cobro.id_orden_trabajo in cobros_por_orden:
            raise OrdenCobroInconsistenteError
        cobros_por_orden[cobro.id_orden_trabajo] = cobro

    ids_cobro = [cobro.id_cobro for cobro in cobros]
    aplicados: dict[int, Decimal] = {}
    if ids_cobro:
        aplicados = {
            id_cobro: _moneda(total)
            for id_cobro, total in db.execute(
                select(
                    PagoDetalle.id_cobro,
                    func.sum(PagoDetalle.monto_aplicado),
                )
                .where(PagoDetalle.id_cobro.in_(ids_cobro))
                .group_by(PagoDetalle.id_cobro)
            ).all()
        }

    response: list[dict[str, Any]] = []
    for row in rows:
        cotizacion = row.Cotizacion
        orden = row.OrdenTrabajo
        monto = _total_cotizacion(cotizacion)
        if monto <= CERO:
            continue
        cobro = cobros_por_orden.get(orden.id_orden)
        if cobro is not None and _moneda(cobro.monto) != monto:
            raise OrdenCobroInconsistenteError
        pagado = CERO if cobro is None else aplicados.get(cobro.id_cobro, CERO)
        saldo = _moneda(monto - pagado)
        if saldo < CERO:
            raise OrdenCobroInconsistenteError
        if saldo == CERO:
            continue
        response.append(
            {
                "id_cotizacion": cotizacion.id_cotizacion,
                "numero_cotizacion": cotizacion.numero_cotizacion,
                "id_orden": orden.id_orden,
                "codigo_orden": orden.codigo,
                "estado_orden": orden.estado,
                "id_cliente": cotizacion.id_cliente,
                "cliente_nombre": _nombre_cliente(
                    cotizacion.cliente,
                    cotizacion.id_cliente,
                ),
                "id_proforma": row.Proforma.id_proforma,
                "monto": monto,
                "total_pagado": pagado,
                "saldo_pendiente": saldo,
                "id_cobro": None if cobro is None else cobro.id_cobro,
                "estado_cotizacion": cotizacion.estado,
            }
        )
    return response


def resolver_cotizacion_orden(
    db: Session,
    id_cotizacion: int,
    id_cliente: int,
) -> tuple[Cotizacion, Proforma, OrdenTrabajo, Decimal]:
    """Valida y bloquea una cotizacion cobrable con proforma del cliente."""

    _requerir_migracion(db)
    row = db.execute(
        _query_cotizaciones_orden(id_cliente, solo_aceptadas=False)
        .where(Cotizacion.id_cotizacion == id_cotizacion)
        .with_for_update(of=Cotizacion)
    ).unique().one_or_none()
    if row is None:
        raise CotizacionOrdenNoEncontradaError
    cotizacion = row.Cotizacion
    orden = row.OrdenTrabajo
    if (
        cotizacion.origen != "ORDEN_TRABAJO"
        or cotizacion.estado not in ("ACEPTADA", "COMPLETADA")
        or row.Proforma is None
        or cotizacion.id_cliente != id_cliente
        or orden.id_cliente != id_cliente
    ):
        raise CotizacionOrdenInvalidaError
    total = _total_cotizacion(cotizacion)
    if total <= CERO:
        raise CotizacionOrdenInvalidaError
    return cotizacion, row.Proforma, orden, total


def obtener_o_crear_cobro_orden(
    db: Session,
    cotizacion: Cotizacion,
    orden: OrdenTrabajo,
    total: Decimal,
) -> Cobro:
    """Crea una sola obligacion por orden o reutiliza la existente."""

    if cotizacion.id_cliente != orden.id_cliente:
        raise OrdenCobroInconsistenteError
    existentes = list(
        db.scalars(
            select(Cobro)
            .options(undefer(Cobro.id_orden_trabajo))
            .where(Cobro.id_orden_trabajo == orden.id_orden)
            .order_by(Cobro.id_cobro)
            .with_for_update(of=Cobro)
        ).all()
    )
    if len(existentes) > 1:
        raise OrdenCobroInconsistenteError
    if existentes:
        cobro = existentes[0]
        if (
            cobro.id_cliente != cotizacion.id_cliente
            or cobro.origen_financiero != ORIGEN_ORDENES
            or _moneda(cobro.monto) != _moneda(total)
            or cobro.estado == "Pagado"
        ):
            raise OrdenCobroInconsistenteError
        return cobro

    fecha_emision: date = db.execute(select(func.current_date())).scalar_one()
    cobro = Cobro(
        id_cliente=cotizacion.id_cliente,
        origen_financiero=ORIGEN_ORDENES,
        id_instalacion=None,
        id_orden_trabajo=orden.id_orden,
        id_servicio=None,
        periodo=None,
        fecha_emision=fecha_emision,
        fecha_vencimiento=None,
        monto=_moneda(total),
        estado="Pendiente",
    )
    db.add(cobro)
    db.flush()
    return cobro


def total_aplicado_cobro(db: Session, id_cobro: int) -> Decimal:
    """Suma las aplicaciones reales registradas para una obligacion."""

    total = db.scalar(
        select(func.sum(PagoDetalle.monto_aplicado)).where(
            PagoDetalle.id_cobro == id_cobro
        )
    )
    return _moneda(total or CERO)


def cotizacion_de_cobro_orden(
    db: Session,
    cobro: Cobro,
) -> tuple[Cotizacion, OrdenTrabajo] | None:
    """Obtiene la cotizacion y orden asociadas a un cobro de orden."""

    id_orden = cobro.id_orden_trabajo
    if id_orden is None:
        return None
    row = db.execute(
        _query_cotizaciones_orden(cobro.id_cliente)
        .where(OrdenTrabajo.id_orden == id_orden)
    ).unique().one_or_none()
    if row is None:
        return None
    return row.Cotizacion, row.OrdenTrabajo


def enriquecer_cobros_orden(
    db: Session,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Agrega el codigo de orden solo cuando la migracion esta aplicada."""

    ids = [
        item["id_cobro"]
        for item in items
        if item.get("origen_financiero") == ORIGEN_ORDENES
    ]
    if not ids or not migracion_ordenes_trabajo_aplicada(db):
        return items
    rows = db.execute(
        select(
            Cobro.id_cobro,
            Cobro.id_orden_trabajo,
            OrdenTrabajo.codigo,
            Cotizacion.numero_cotizacion,
            Proforma.id_proforma,
        )
        .join(
            OrdenTrabajo,
            and_(
                OrdenTrabajo.id_orden == Cobro.id_orden_trabajo,
                OrdenTrabajo.id_cliente == Cobro.id_cliente,
            ),
        )
        .join(
            EvaluacionOrden,
            EvaluacionOrden.id_orden == OrdenTrabajo.id_orden,
        )
        .join(
            Cotizacion,
            Cotizacion.id_evaluacion_orden == EvaluacionOrden.id_evaluacion,
        )
        .outerjoin(
            Proforma,
            Proforma.id_cotizacion == Cotizacion.id_cotizacion,
        )
        .where(Cobro.id_cobro.in_(ids))
    ).all()
    por_cobro = {row.id_cobro: row for row in rows}
    for item in items:
        datos = por_cobro.get(item["id_cobro"])
        if datos is not None:
            item["id_orden_trabajo"] = datos.id_orden_trabajo
            item["codigo_orden"] = datos.codigo
            item["numero_cotizacion"] = datos.numero_cotizacion
            item["id_proforma"] = datos.id_proforma
    return items
