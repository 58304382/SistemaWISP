"""Integracion financiera de cotizaciones de instalacion con Cobros.

Reutiliza la estructura real existente: una cotizacion de origen EVALUACION
con proforma vigente representa la obligacion cobrable de la instalacion.
La obligacion fisica se sigue materializando mediante
``obtener_o_crear_cobro_instalacion`` para no duplicar obligaciones.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, Proforma
from app.modules.cotizaciones.services.cotizaciones import calcular_totales
from app.modules.finanzas.models.cobros import Cobro, PagoDetalle
from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.visitas_tecnicas.models.evaluacion_visita import EvaluacionVisita


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
ORIGEN_INSTALACIONES = "INSTALACIONES"
ESTADOS_COBRABLES = ("ACEPTADA", "COMPLETADA")


class CotizacionInstalacionNoEncontradaError(Exception):
    """La cotizacion de instalacion no existe o no pertenece al cliente."""


class CotizacionInstalacionInvalidaError(Exception):
    """La cotizacion no es una obligacion de instalacion cobrable."""


class InstalacionCobroInconsistenteError(Exception):
    """La obligacion persistida no coincide con la cotizacion de instalacion."""


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


def _total_cotizacion(cotizacion: Cotizacion) -> Decimal:
    """Reutiliza el calculo real de Cotizaciones, incluidos descuentos."""

    _, _, _, total = calcular_totales(
        cotizacion.detalles,
        cotizacion.porcentaje_descuento,
    )
    return _moneda(total)


def _query_cotizaciones_instalacion(
    id_cliente: int | None = None,
    *,
    solo_cobrables: bool = True,
):
    """Cotizaciones EVALUACION con proforma vigente y su instalacion opcional.

    Una misma visita puede tener varias instalaciones y todas comparten la
    cotizacion. El LEFT JOIN evita ocultar cotizaciones cuya visita aun no
    tiene instalacion programada, manteniendo la relacion real cuando existe.
    """

    query = (
        select(Cotizacion, Proforma, Instalacion)
        .join(
            EvaluacionVisita,
            EvaluacionVisita.id_evaluacion == Cotizacion.id_evaluacion,
        )
        # La instalacion aun no programada no debe ocultar la cotizacion
        # aceptada: el flujo de ordenes tampoco exige su entidad posterior.
        # El LEFT JOIN conserva la cotizacion aunque la visita no tenga fila
        # en instalaciones; la obligacion se vincula por id_cotizacion.
        .outerjoin(
            Instalacion,
            and_(
                Instalacion.id_visita == EvaluacionVisita.id_visita,
                Instalacion.id_cliente == Cotizacion.id_cliente,
            ),
        )
        .join(
            Proforma,
            Proforma.id_cotizacion == Cotizacion.id_cotizacion,
        )
        .options(
            selectinload(Cotizacion.detalles),
            joinedload(Cotizacion.cliente),
        )
        .where(Cotizacion.origen == "EVALUACION")
        .order_by(Instalacion.id_instalacion, Cotizacion.id_cotizacion)
    )
    if solo_cobrables:
        query = query.where(Cotizacion.estado.in_(ESTADOS_COBRABLES))
    if id_cliente is not None:
        query = query.where(Cotizacion.id_cliente == id_cliente)
    return query


def listar_cotizaciones_instalacion(
    db: Session,
    id_cliente: int,
) -> list[dict[str, Any]]:
    """Lista cotizaciones cobrables con proforma y saldo real pendiente.

    Cuando varias instalaciones comparten la misma visita se devuelve una sola
    fila por cotizacion, referenciando la instalacion de menor identificador.
    Si la visita aun no tiene instalacion, la fila conserva la cotizacion y
    resuelve la obligacion exclusivamente mediante ``id_cotizacion``.
    """

    rows = (
        db.execute(_query_cotizaciones_instalacion(id_cliente))
        .unique()
        .all()
    )
    if not rows:
        return []

    # La cotizacion es el documento comun de la visita: se conserva una sola
    # fila para no ofrecer la misma obligacion mas de una vez.
    filas_por_cotizacion: dict[int, Any] = {}
    for row in rows:
        filas_por_cotizacion.setdefault(row.Cotizacion.id_cotizacion, row)

    ids_cotizacion = [
        row.Cotizacion.id_cotizacion for row in filas_por_cotizacion.values()
    ]
    cobros_por_cotizacion: dict[int, Cobro] = {}
    if ids_cotizacion:
        cobros = db.scalars(
            select(Cobro)
            .where(
                Cobro.origen_financiero == ORIGEN_INSTALACIONES,
                Cobro.id_cotizacion.in_(ids_cotizacion),
            )
            .order_by(Cobro.id_cobro)
        ).all()
        for cobro in cobros:
            if cobro.id_cotizacion is None:
                continue
            # El indice unico de PostgreSQL protege la regla; esta validacion
            # conserva un error explicito si el esquema o datos estan fuera de
            # sincronizacion.
            if cobro.id_cotizacion in cobros_por_cotizacion:
                raise InstalacionCobroInconsistenteError
            cobros_por_cotizacion[cobro.id_cotizacion] = cobro

    ids_cobro = [cobro.id_cobro for cobro in cobros_por_cotizacion.values()]
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
    for row in filas_por_cotizacion.values():
        cotizacion = row.Cotizacion
        instalacion = row.Instalacion
        monto = _total_cotizacion(cotizacion)
        if monto <= CERO:
            continue
        # La cotizacion identifica la obligacion incluso sin contexto tecnico.
        cobro = cobros_por_cotizacion.get(cotizacion.id_cotizacion)
        if cobro is not None and _moneda(cobro.monto) != monto:
            raise InstalacionCobroInconsistenteError
        pagado = CERO if cobro is None else aplicados.get(cobro.id_cobro, CERO)
        saldo = _moneda(monto - pagado)
        if saldo < CERO:
            raise InstalacionCobroInconsistenteError
        if saldo == CERO:
            continue
        response.append(
            {
                "id_cotizacion": cotizacion.id_cotizacion,
                "numero_cotizacion": cotizacion.numero_cotizacion,
                # La instalacion es contexto tecnico opcional; la obligacion
                # financiera se identifica por la cotizacion.
                "id_instalacion": None if instalacion is None else instalacion.id_instalacion,
                "estado_instalacion": None if instalacion is None else instalacion.estado,
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


def resolver_cotizacion_instalacion(
    db: Session,
    id_cotizacion: int,
    id_cliente: int,
) -> tuple[Cotizacion, Proforma, Instalacion | None, Decimal]:
    """Valida y bloquea una cotizacion cobrable con proforma del cliente."""

    row = (
        db.execute(
            _query_cotizaciones_instalacion(id_cliente, solo_cobrables=False)
            .where(Cotizacion.id_cotizacion == id_cotizacion)
            .with_for_update(of=Cotizacion)
            .limit(1)
        )
        .unique()
        .one_or_none()
    )
    if row is None:
        raise CotizacionInstalacionNoEncontradaError
    cotizacion = row.Cotizacion
    instalacion = row.Instalacion
    if (
        cotizacion.origen != "EVALUACION"
        or cotizacion.estado not in ESTADOS_COBRABLES
        or row.Proforma is None
        or cotizacion.id_cliente != id_cliente
        or (
            instalacion is not None
            and instalacion.id_cliente != id_cliente
        )
    ):
        raise CotizacionInstalacionInvalidaError
    total = _total_cotizacion(cotizacion)
    if total <= CERO:
        raise CotizacionInstalacionInvalidaError
    return cotizacion, row.Proforma, instalacion, total


def obtener_o_crear_cobro_instalacion(
    db: Session,
    cotizacion: Cotizacion,
    total: Decimal,
) -> Cobro:
    """Obtiene una unica obligacion identificada por la cotizacion.

    ``id_instalacion`` permanece nulo cuando el pago ocurre antes de
    programar el trabajo. La unicidad persistente de ``id_cotizacion`` evita
    duplicados y permite reutilizar la misma obligacion en pagos posteriores.
    """

    existentes = list(
        db.scalars(
            select(Cobro)
            .where(
                Cobro.id_cotizacion == cotizacion.id_cotizacion,
                Cobro.id_cliente == cotizacion.id_cliente,
                Cobro.origen_financiero == ORIGEN_INSTALACIONES,
            )
            .order_by(Cobro.id_cobro)
            .with_for_update(of=Cobro)
        ).all()
    )
    if len(existentes) > 1:
        raise InstalacionCobroInconsistenteError
    if existentes:
        cobro = existentes[0]
        if (
            cobro.id_cliente != cotizacion.id_cliente
            or cobro.origen_financiero != ORIGEN_INSTALACIONES
            or _moneda(cobro.monto) != _moneda(total)
            or cobro.estado == "Pagado"
        ):
            raise InstalacionCobroInconsistenteError
        return cobro

    fecha_emision: date = db.execute(select(func.current_date())).scalar_one()
    cobro = Cobro(
        id_cliente=cotizacion.id_cliente,
        origen_financiero=ORIGEN_INSTALACIONES,
        id_instalacion=None,
        id_cotizacion=cotizacion.id_cotizacion,
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
