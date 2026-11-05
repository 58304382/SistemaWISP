"""Transacciones y consultas de la unica Caja General del sistema."""

from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import case, func, select, text, or_
from sqlalchemy.orm import Session

from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.caja import ArqueoCaja, CategoriaCaja, MovimientoCaja, SesionCaja, EntregaPagoDetalle
from app.modules.finanzas.models.cobros import MetodoPago, Pago
from app.modules.finanzas.schemas.caja import (
    AperturaCajaCreate,
    ArqueoCajaResponse,
    CierreCajaCreate,
    CierreCajaResponse,
    MovimientoManualCajaCreate,
    SesionCajaResponse,
)


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
ESTADO_ACTIVO = "Activo"
ESTADO_SESION_ABIERTA = "Abierta"
TIPO_INGRESO = "Ingreso"
TIPO_EGRESO = "Egreso"
CATEGORIAS_MANUALES_POR_TIPO = {
    TIPO_INGRESO: "Entrada",
    TIPO_EGRESO: "Salida",
}
CLAVE_BLOQUEO_CAJA = "sistemawisp:caja-general:operaciones"


class SesionCajaAbiertaError(Exception):
    """Ya existe una sesion abierta para la Caja General unica."""


class SesionCajaNoAbiertaError(Exception):
    """No existe una sesion abierta donde registrar movimientos."""


class SesionesCajaInconsistentesError(Exception):
    """La base contiene mas de una sesion marcada como abierta."""


class SesionCajaNoEncontradaError(Exception):
    """La sesion concreta solicitada para cierre no existe."""


class ResponsableCierreInvalidoError(Exception):
    """Solo el empleado que abrio la sesion puede cerrarla."""


class EfectivoCierreDesactualizadoError(Exception):
    """El efectivo cambio desde la revision del formulario; requiere confirmar de nuevo."""


class HistoricosSinClasificarError(Exception):
    """No se puede afirmar un esperado físico para efectivo histórico sin custodia."""


class EntregasPendientesError(Exception):
    """La sesión no puede cerrarse dejando efectivo pendiente sin recepción."""


class CategoriaCajaInvalidaError(Exception):
    """La categoria no existe, esta inactiva o no corresponde al tipo."""


class MetodoPagoCajaInvalidoError(Exception):
    """El metodo de pago no existe o esta inactivo."""


class ReferenciaMovimientoRequeridaError(Exception):
    """Un movimiento no efectivo requiere trazabilidad bancaria."""


class FondosCajaInsuficientesError(Exception):
    """El egreso en efectivo supera el efectivo fisico disponible."""

    def __init__(self, disponible: Decimal, solicitado: Decimal) -> None:
        self.disponible = disponible
        self.solicitado = solicitado
        super().__init__("Fondos insuficientes en Caja General")


class MovimientoCajaDuplicadoError(Exception):
    """La misma huella financiera ya fue confirmada en la sesion."""

    def __init__(self, id_movimiento: int) -> None:
        self.id_movimiento = id_movimiento
        super().__init__(f"Movimiento duplicado: {id_movimiento}")


def _moneda(value: Decimal | int) -> Decimal:
    return Decimal(value).quantize(MONEDA, rounding=ROUND_HALF_UP)


def _normalizar_texto(value: str) -> str:
    # Coincide con lower(trim(...)) usado en el agregado PostgreSQL de efectivo.
    return value.casefold().strip()


def _es_efectivo(metodo: MetodoPago) -> bool:
    """Solo el metodo denominado Efectivo modifica el dinero fisico en Caja."""

    return _normalizar_texto(metodo.nombre) == "efectivo"


def _bloquear_caja(db: Session) -> None:
    """Serializa aperturas y movimientos durante toda la transaccion PostgreSQL."""

    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
        {"clave": CLAVE_BLOQUEO_CAJA},
    )


def _sesion_abierta(db: Session, *, for_update: bool = False) -> SesionCaja | None:
    query = select(SesionCaja).where(SesionCaja.estado == ESTADO_SESION_ABIERTA)
    if for_update:
        query = query.with_for_update(of=SesionCaja)
    sesiones = list(db.scalars(query.order_by(SesionCaja.id_sesion)).all())
    if len(sesiones) > 1:
        raise SesionesCajaInconsistentesError
    return sesiones[0] if sesiones else None


def _liquidado_pago_subquery():
    return (select(func.coalesce(func.sum(
        EntregaPagoDetalle.monto_entregado + EntregaPagoDetalle.monto_gasto_autorizado), CERO))
        .where(EntregaPagoDetalle.id_pago == Pago.id_pago).correlate(Pago).scalar_subquery())


def calcular_efectivo_disponible(db: Session, sesion: SesionCaja) -> Decimal:
    """Cuenta efectivo confirmado; no supone que el aperturista recibió cada pago.

    El bruto de empleados de Internet solo queda disponible al liquidarse por entrega/gasto.
    Los gastos figuran como egresos una vez; no se suman entregas como ingresos.
    Los históricos de Internet no clasificados se excluyen del disponible confirmado.
    """

    liquidado = _liquidado_pago_subquery()
    ingreso_confirmado = case(
        (Pago.id_pago.is_(None), MovimientoCaja.monto),
        (Pago.origen_financiero != "INTERNET", MovimientoCaja.monto),
        (Pago.recepcion_efectivo == "CAJA_GENERAL", MovimientoCaja.monto),
        (Pago.recepcion_efectivo == "EMPLEADO", liquidado),
        else_=CERO,
    )

    variacion = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (MovimientoCaja.tipo == TIPO_INGRESO, ingreso_confirmado),
                        (MovimientoCaja.tipo == TIPO_EGRESO, -MovimientoCaja.monto),
                        else_=CERO,
                    )
                ),
                CERO,
            )
        )
        .select_from(MovimientoCaja)
        .join(MetodoPago, MetodoPago.id_metodo_pago == MovimientoCaja.id_metodo_pago)
        .outerjoin(Pago, Pago.id_movimiento_caja == MovimientoCaja.id_movimiento)
        .where(
            MovimientoCaja.id_sesion == sesion.id_sesion,
            func.lower(func.trim(MetodoPago.nombre)) == "efectivo",
        )
    )
    return _moneda(_moneda(sesion.saldo_inicial) + _moneda(variacion or CERO))


def _sesion_response(db: Session, sesion: SesionCaja) -> dict[str, Any]:
    return {
        "id_sesion": sesion.id_sesion,
        "id_empleado": sesion.id_empleado,
        "fecha_apertura": sesion.fecha_apertura,
        "fecha_cierre": sesion.fecha_cierre,
        "saldo_inicial": _moneda(sesion.saldo_inicial),
        "saldo_final": None if sesion.saldo_final is None else _moneda(sesion.saldo_final),
        "estado": sesion.estado,
        "efectivo_disponible": calcular_efectivo_disponible(db, sesion),
    }


def abrir_caja(
    db: Session,
    data: AperturaCajaCreate,
    id_empleado: int,
) -> dict[str, Any]:
    """Abre la Caja unica bajo lock transaccional y toma la hora de PostgreSQL."""

    try:
        _bloquear_caja(db)
        if _sesion_abierta(db, for_update=True) is not None:
            raise SesionCajaAbiertaError
        # Las columnas reales son timestamp sin zona horaria; localtimestamp
        # evita responder un valor aware distinto del que PostgreSQL persiste.
        fecha_apertura = db.scalar(select(func.localtimestamp()))
        if fecha_apertura is None:
            raise RuntimeError("PostgreSQL no devolvio la fecha de apertura")

        sesion = SesionCaja(
            id_empleado=id_empleado,
            fecha_apertura=fecha_apertura,
            fecha_cierre=None,
            saldo_inicial=_moneda(data.saldo_inicial),
            saldo_final=None,
            estado=ESTADO_SESION_ABIERTA,
        )
        db.add(sesion)
        db.flush()
        response = _sesion_response(db, sesion)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def get_sesion_actual(db: Session) -> dict[str, Any] | None:
    """Consulta la unica sesion abierta y detecta estados persistidos invalidos."""

    sesion = _sesion_abierta(db)
    return None if sesion is None else _sesion_response(db, sesion)


def cerrar_caja(
    db: Session,
    id_sesion: int,
    data: CierreCajaCreate,
    id_empleado: int,
) -> dict[str, Any]:
    """Cierra la sesion y registra el arqueo en una unica transaccion.

    Comparte el bloqueo de aperturas, movimientos manuales y Cobros: ningun
    ingreso o egreso puede intercalarse entre el calculo fisico y el cierre.
    El ID explicito impide que un reintento cierre una sesion posterior.
    """

    try:
        _bloquear_caja(db)
        sesion = db.scalar(
            select(SesionCaja)
            .where(SesionCaja.id_sesion == id_sesion)
            .with_for_update(of=SesionCaja)
        )
        if sesion is None:
            raise SesionCajaNoEncontradaError
        if sesion.id_empleado != id_empleado:
            raise ResponsableCierreInvalidoError
        if sesion.estado != ESTADO_SESION_ABIERTA or sesion.fecha_cierre is not None:
            raise SesionCajaNoAbiertaError
        # Reutiliza la deteccion de sesiones abiertas inconsistentes antes de escribir.
        abierta = _sesion_abierta(db, for_update=True)
        if abierta is None or abierta.id_sesion != id_sesion:
            raise SesionCajaNoAbiertaError

        historicos = db.scalar(select(func.count()).select_from(Pago)
            .join(MovimientoCaja, MovimientoCaja.id_movimiento == Pago.id_movimiento_caja)
            .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
            .where(MovimientoCaja.id_sesion == id_sesion,
                   Pago.origen_financiero == "INTERNET",
                   or_(Pago.recepcion_efectivo.is_(None), Pago.recepcion_efectivo.not_in(("CAJA_GENERAL", "EMPLEADO"))),
                   func.lower(func.trim(MetodoPago.nombre)) == "efectivo"))
        if historicos:
            raise HistoricosSinClasificarError
        pendientes = db.scalar(select(func.count()).select_from(Pago)
            .join(MovimientoCaja, MovimientoCaja.id_movimiento == Pago.id_movimiento_caja)
            .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
            .where(MovimientoCaja.id_sesion == id_sesion,
                   Pago.origen_financiero == "INTERNET",
                   Pago.recepcion_efectivo == "EMPLEADO",
                   Pago.monto_total > _liquidado_pago_subquery(),
                   func.lower(func.trim(MetodoPago.nombre)) == "efectivo"))
        if pendientes:
            raise EntregasPendientesError

        # Solo EFECTIVO: incluye cada origen una vez; la custodia se aplica a Internet.
        esperado = calcular_efectivo_disponible(db, sesion)
        if esperado != _moneda(data.monto_sistema):
            raise EfectivoCierreDesactualizadoError
        contado = _moneda(data.monto_contado)
        fecha = db.scalar(select(func.localtimestamp()))
        if fecha is None:
            raise RuntimeError("PostgreSQL no devolvio la fecha de cierre")

        arqueo = ArqueoCaja(
            id_sesion=sesion.id_sesion,
            monto_sistema=esperado,
            monto_contado=contado,
            diferencia=_moneda(contado - esperado),
            observaciones=data.observaciones,
            fecha_hora=fecha,
        )
        # id_empleado se conserva: la misma persona es responsable de apertura y cierre.
        sesion.fecha_cierre = fecha
        sesion.saldo_final = contado
        sesion.estado = "Cerrada"
        db.add(arqueo)
        db.flush()
        # Valida la respuesta antes del commit para revertir tambien fallos de serializacion.
        response = CierreCajaResponse(
            **SesionCajaResponse.model_validate(sesion).model_dump(),
            efectivo_disponible=esperado,
            arqueo=ArqueoCajaResponse.model_validate(arqueo),
        ).model_dump()
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def list_categorias_manuales_activas(
    db: Session,
    tipo: str,
) -> list[CategoriaCaja]:
    """Lista la categoria manual activa sin exponer origenes automaticos.

    Servicios de Internet, Instalaciones y Ordenes de trabajo corresponden a
    procesos automaticos y no pueden seleccionarse en un movimiento manual.
    """

    nombre = CATEGORIAS_MANUALES_POR_TIPO[tipo]
    return list(
        db.scalars(
            select(CategoriaCaja)
            .where(
                CategoriaCaja.estado == ESTADO_ACTIVO,
                CategoriaCaja.tipo == tipo,
                CategoriaCaja.nombre == nombre,
            )
            .order_by(CategoriaCaja.nombre, CategoriaCaja.id_categoria)
        ).all()
    )


def _validar_catalogos(
    categoria: CategoriaCaja | None,
    metodo: MetodoPago | None,
    data: MovimientoManualCajaCreate,
) -> tuple[CategoriaCaja, MetodoPago, bool]:
    """Valida estado, tipo y trazabilidad segun los catalogos persistidos."""

    if categoria is None or categoria.estado != ESTADO_ACTIVO:
        raise CategoriaCajaInvalidaError
    if categoria.tipo != data.tipo:
        raise CategoriaCajaInvalidaError
    # El endpoint manual no puede atribuir movimientos a origenes automaticos.
    if categoria.nombre != CATEGORIAS_MANUALES_POR_TIPO[data.tipo]:
        raise CategoriaCajaInvalidaError
    if metodo is None or metodo.estado != ESTADO_ACTIVO:
        raise MetodoPagoCajaInvalidoError

    es_efectivo = _es_efectivo(metodo)
    if not es_efectivo and data.referencia is None:
        raise ReferenciaMovimientoRequeridaError
    return categoria, metodo, es_efectivo


def _movimiento_duplicado(
    db: Session,
    sesion: SesionCaja,
    data: MovimientoManualCajaCreate,
    id_responsable: int,
) -> int | None:
    """Busca la huella exacta tras serializar solicitudes de Caja.

    El esquema no posee una clave de idempotencia. Esta comparación persistente
    evita que un reintento idéntico confirme dos movimientos en la misma sesion.
    """

    return db.scalar(
        select(MovimientoCaja.id_movimiento).where(
            MovimientoCaja.id_sesion == sesion.id_sesion,
            MovimientoCaja.id_categoria == data.id_categoria,
            MovimientoCaja.id_metodo_pago == data.id_metodo_pago,
            MovimientoCaja.id_responsable == id_responsable,
            MovimientoCaja.tipo == data.tipo,
            MovimientoCaja.concepto == data.concepto,
            MovimientoCaja.monto == data.monto,
            MovimientoCaja.referencia == data.referencia,
            MovimientoCaja.observaciones == data.observaciones,
            MovimientoCaja.id_salida_producto.is_(None),
        )
    )


def _movimiento_response(
    movimiento: MovimientoCaja,
    categoria: CategoriaCaja,
    metodo: MetodoPago | None,
    responsable: Empleado,
) -> dict[str, Any]:
    """Conserva el origen persistido, incluido NULL para movimientos manuales."""

    return {
        "id_movimiento": movimiento.id_movimiento,
        "id_sesion": movimiento.id_sesion,
        "id_categoria": movimiento.id_categoria,
        "id_metodo_pago": movimiento.id_metodo_pago,
        "id_responsable": movimiento.id_responsable,
        "tipo": movimiento.tipo,
        "origen_financiero": movimiento.origen_financiero,
        "concepto": movimiento.concepto,
        "monto": _moneda(movimiento.monto),
        "referencia": movimiento.referencia,
        "id_salida_producto": movimiento.id_salida_producto,
        "observaciones": movimiento.observaciones,
        "fecha_hora": movimiento.fecha_hora,
        "categoria": categoria.nombre,
        "metodo_pago": None if metodo is None else metodo.nombre,
        "responsable": f"{responsable.nombres} {responsable.apellidos}".strip(),
        "es_efectivo": metodo is not None and _es_efectivo(metodo),
    }


def registrar_movimiento_manual(
    db: Session,
    data: MovimientoManualCajaCreate,
    responsable: Empleado,
) -> dict[str, Any]:
    """Confirma un movimiento atomico con control de sesion, saldo e idempotencia."""

    try:
        _bloquear_caja(db)
        sesion = _sesion_abierta(db, for_update=True)
        if sesion is None:
            raise SesionCajaNoAbiertaError

        categoria = db.scalar(
            select(CategoriaCaja).where(CategoriaCaja.id_categoria == data.id_categoria)
        )
        metodo = db.scalar(
            select(MetodoPago).where(MetodoPago.id_metodo_pago == data.id_metodo_pago)
        )
        categoria, metodo, es_efectivo = _validar_catalogos(categoria, metodo, data)

        duplicate_id = _movimiento_duplicado(
            db,
            sesion,
            data,
            responsable.id_empleado,
        )
        if duplicate_id is not None:
            raise MovimientoCajaDuplicadoError(duplicate_id)

        if data.tipo == TIPO_EGRESO and es_efectivo:
            disponible = calcular_efectivo_disponible(db, sesion)
            if _moneda(data.monto) > disponible:
                raise FondosCajaInsuficientesError(disponible, _moneda(data.monto))

        fecha_hora = db.scalar(select(func.localtimestamp()))
        if fecha_hora is None:
            raise RuntimeError("PostgreSQL no devolvio la fecha del movimiento")
        movimiento = MovimientoCaja(
            id_sesion=sesion.id_sesion,
            id_categoria=categoria.id_categoria,
            id_metodo_pago=metodo.id_metodo_pago,
            id_responsable=responsable.id_empleado,
            tipo=data.tipo,
            concepto=data.concepto,
            monto=_moneda(data.monto),
            referencia=data.referencia,
            id_salida_producto=None,
            observaciones=data.observaciones,
            fecha_hora=fecha_hora,
        )
        db.add(movimiento)
        db.flush()
        response = _movimiento_response(movimiento, categoria, metodo, responsable)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def list_movimientos_caja(
    db: Session,
    *,
    page: int,
    page_size: int,
    id_sesion: int | None = None,
    tipo: str | None = None,
    id_categoria: int | None = None,
    id_metodo_pago: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
) -> dict[str, Any]:
    """Pagina la trazabilidad inmutable usando solo relaciones fisicas."""

    filters = []
    if id_sesion is not None:
        filters.append(MovimientoCaja.id_sesion == id_sesion)
    if tipo is not None:
        filters.append(MovimientoCaja.tipo == tipo)
    if id_categoria is not None:
        filters.append(MovimientoCaja.id_categoria == id_categoria)
    if id_metodo_pago is not None:
        filters.append(MovimientoCaja.id_metodo_pago == id_metodo_pago)
    if fecha_desde is not None:
        filters.append(
            MovimientoCaja.fecha_hora >= datetime.combine(fecha_desde, time.min)
        )
    if fecha_hasta is not None:
        filters.append(
            MovimientoCaja.fecha_hora <= datetime.combine(fecha_hasta, time.max)
        )

    total = int(
        db.scalar(select(func.count()).select_from(MovimientoCaja).where(*filters)) or 0
    )
    rows = db.execute(
        select(
            MovimientoCaja,
            CategoriaCaja,
            MetodoPago,
            Empleado,
        )
        .join(CategoriaCaja, CategoriaCaja.id_categoria == MovimientoCaja.id_categoria)
        .outerjoin(MetodoPago, MetodoPago.id_metodo_pago == MovimientoCaja.id_metodo_pago)
        .join(Empleado, Empleado.id_empleado == MovimientoCaja.id_responsable)
        .where(*filters)
        .order_by(MovimientoCaja.fecha_hora.desc(), MovimientoCaja.id_movimiento.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            _movimiento_response(
                row.MovimientoCaja,
                row.CategoriaCaja,
                row.MetodoPago,
                row.Empleado,
            )
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }
