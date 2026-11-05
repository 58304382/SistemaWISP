"""Custodia de efectivo y entregas confirmadas, sin duplicar ingresos de Cobros."""

from decimal import Decimal
from sqlalchemy import func, select

from app.modules.clientes.models.cliente import Cliente
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.caja import EntregaCobrador, EntregaPagoDetalle, MovimientoCaja, SesionCaja
from app.modules.finanzas.models.cobros import Pago, MetodoPago
from app.modules.finanzas.services.caja import (
    CERO, _moneda, _es_efectivo, _bloquear_caja, _sesion_abierta,
    list_categorias_manuales_activas,
)


class EntregaInvalidaError(Exception):
    """El cierre contradice la custodia, la sesión o una confirmación anterior."""

    def __init__(self, mensaje, status_code=409):
        self.status_code = status_code
        super().__init__(mensaje)


def _pagos_sesion(db, id_sesion, ids=None, bloquear=False):
    query = (select(Pago, MetodoPago, Cliente, Empleado)
             .join(MovimientoCaja, MovimientoCaja.id_movimiento == Pago.id_movimiento_caja)
             .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
             .join(Cliente, Cliente.id_cliente == Pago.id_cliente)
             .join(Empleado, Empleado.id_empleado == Pago.id_empleado)
             .where(MovimientoCaja.id_sesion == id_sesion)
             .order_by(Pago.id_pago))
    if ids is not None:
        query = query.where(Pago.id_pago.in_(ids))
    if bloquear:
        query = query.with_for_update(of=Pago)
    return list(db.execute(query).all())


def _liquidaciones(db, ids):
    if not ids:
        return {}
    rows = db.execute(select(
        EntregaPagoDetalle.id_pago,
        func.sum(EntregaPagoDetalle.monto_entregado),
        func.sum(EntregaPagoDetalle.monto_gasto_autorizado),
    ).where(EntregaPagoDetalle.id_pago.in_(ids)).group_by(EntregaPagoDetalle.id_pago)).all()
    return {identifier: (_moneda(neto), _moneda(gasto)) for identifier, neto, gasto in rows}


def _pago_pendiente(row, liquidado):
    pago = row.Pago
    entregado, gasto = liquidado.get(pago.id_pago, (CERO, CERO))
    pendiente = _moneda(pago.monto_total) - entregado - gasto
    if entregado < CERO or gasto < CERO or pendiente < CERO:
        raise EntregaInvalidaError("Las entregas registradas superan o contradicen el pago")
    return {
        "id_pago": pago.id_pago, "id_cliente": pago.id_cliente,
        "cliente": f"{row.Cliente.nombres} {row.Cliente.apellidos}".strip(),
        "origen": pago.origen_financiero, "fecha_hora": pago.fecha_hora,
        "monto_recaudado": _moneda(pago.monto_total),
        "monto_entregado": entregado, "gastos_autorizados": gasto,
        "pendiente": _moneda(pendiente),
    }


def calcular_conciliacion(sesion, filas, liquidado, movimientos):
    """Calcula custodia por sesión completa, nunca por fecha actual ni por puesto.

    Solo Internet controla custodia. Sus pagos NULL son históricos no
    clasificables y dejan indeterminado el efectivo hasta resolverlos.
    """
    origenes = {origen: {"origen": origen, "efectivo": CERO, "transferencias": CERO, "otros": CERO}
                for origen in ("INTERNET", "INSTALACIONES", "ORDENES_TRABAJO")}
    empleados = {}
    historicos = []
    directo = CERO
    for row in filas:
        pago = row.Pago
        if pago.origen_financiero not in origenes:
            raise EntregaInvalidaError("El pago contiene un origen financiero desconocido")
        tipo = "efectivo" if _es_efectivo(row.MetodoPago) else (
            "transferencias" if row.MetodoPago.nombre.strip().casefold() == "transferencia" else "otros")
        origenes[pago.origen_financiero][tipo] += _moneda(pago.monto_total)
        if tipo != "efectivo":
            continue
        if pago.origen_financiero != "INTERNET":
            directo += _moneda(pago.monto_total)
            continue
        detalle = _pago_pendiente(row, liquidado)
        if pago.recepcion_efectivo is None:
            historicos.append(detalle)
        elif pago.recepcion_efectivo == "CAJA_GENERAL":
            directo += _moneda(pago.monto_total)
        elif pago.recepcion_efectivo == "EMPLEADO":
            empleado = empleados.setdefault(pago.id_empleado, {
                "id_empleado": pago.id_empleado,
                "codigo": row.Empleado.codigo,
                "empleado": f"{row.Empleado.nombres} {row.Empleado.apellidos}".strip(),
                "recaudado": CERO, "entregado": CERO, "gastos": CERO, "pendiente": CERO,
                "pagos_pendientes": [],
            })
            empleado["recaudado"] += detalle["monto_recaudado"]
            empleado["entregado"] += detalle["monto_entregado"]
            empleado["gastos"] += detalle["gastos_autorizados"]
            empleado["pendiente"] += detalle["pendiente"]
            if detalle["pendiente"] > CERO:
                empleado["pagos_pendientes"].append(detalle)
        else:
            raise EntregaInvalidaError("Hay pagos con una recepción física inválida")
    entradas = sum((m.monto for m in movimientos if m.tipo == "Ingreso"), CERO)
    salidas = sum((m.monto for m in movimientos if m.tipo == "Egreso"), CERO)
    pendiente = sum((e["pendiente"] for e in empleados.values()), CERO)
    sin_clasificar = sum((p["monto_recaudado"] for p in historicos), CERO)
    # Las entregas no se suman: el ingreso bruto ya está en movimientos. Los
    # gastos ya figuran como egresos y NO se descuentan otra vez de este cálculo.
    confirmado = _moneda(sesion.saldo_inicial + entradas - salidas - pendiente - sin_clasificar)
    return {
        "id_sesion": sesion.id_sesion, "saldo_inicial": _moneda(sesion.saldo_inicial),
        "cobros": list(origenes.values()), "recibido_directamente": _moneda(directo),
        "entradas_efectivo": _moneda(entradas), "salidas_efectivo": _moneda(salidas),
        "total_efectivo": sum((o["efectivo"] for o in origenes.values()), CERO),
        "total_transferencias": sum((o["transferencias"] for o in origenes.values()), CERO),
        "total_entregado": sum((e["entregado"] for e in empleados.values()), CERO),
        "gastos_autorizados": sum((e["gastos"] for e in empleados.values()), CERO),
        "pendiente_entrega": pendiente, "historicos": historicos,
        "efectivo_sin_clasificar": sin_clasificar, "efectivo_confirmado": confirmado,
        "efectivo_esperado": None if historicos else confirmado,
        "empleados": sorted(empleados.values(), key=lambda e: e["empleado"]),
    }


def resumen_sesion(db, id_sesion):
    sesion = db.get(SesionCaja, id_sesion)
    if sesion is None:
        raise EntregaInvalidaError("Sesión de Caja no encontrada", 404)
    filas = _pagos_sesion(db, id_sesion)
    liquidado = _liquidaciones(db, [r.Pago.id_pago for r in filas])
    efectivo = list(db.scalars(select(MovimientoCaja)
        .join(MetodoPago, MetodoPago.id_metodo_pago == MovimientoCaja.id_metodo_pago)
        .where(MovimientoCaja.id_sesion == id_sesion,
               func.lower(func.trim(MetodoPago.nombre)) == "efectivo")).all())
    return calcular_conciliacion(sesion, filas, liquidado, efectivo)


def detalle_entrega(db, entrega):
    detalles = list(db.scalars(select(EntregaPagoDetalle)
        .where(EntregaPagoDetalle.id_entrega == entrega.id_entrega)
        .order_by(EntregaPagoDetalle.id_pago)).all())
    filas = _pagos_sesion(db, entrega.id_sesion, [d.id_pago for d in detalles])
    por_id = {r.Pago.id_pago: r for r in filas}
    gastos = list(db.scalars(select(MovimientoCaja)
        .where(MovimientoCaja.id_entrega_cobrador == entrega.id_entrega)
        .order_by(MovimientoCaja.id_movimiento)).all())
    empleado = db.get(Empleado, entrega.id_empleado)
    receptor = db.get(Empleado, entrega.id_administrativo)
    return {
        "id_entrega": entrega.id_entrega, "id_sesion": entrega.id_sesion,
        "id_empleado": entrega.id_empleado,
        "empleado": f"{empleado.nombres} {empleado.apellidos}" if empleado else str(entrega.id_empleado),
        "id_administrativo": entrega.id_administrativo,
        "responsable_recepcion": f"{receptor.nombres} {receptor.apellidos}" if receptor else str(entrega.id_administrativo),
        "fecha_hora": entrega.fecha_hora, "monto_entregado": _moneda(entrega.monto_entregado),
        "observaciones": entrega.observaciones,
        "recaudado": sum((d.monto_entregado + d.monto_gasto_autorizado for d in detalles), CERO),
        "gastos_autorizados": sum((d.monto_gasto_autorizado for d in detalles), CERO),
        "pagos": [{"id_pago": d.id_pago, "cliente": f"{por_id[d.id_pago].Cliente.nombres} {por_id[d.id_pago].Cliente.apellidos}",
                   "origen": por_id[d.id_pago].Pago.origen_financiero,
                   "monto_entregado": d.monto_entregado, "monto_gasto_autorizado": d.monto_gasto_autorizado}
                  for d in detalles],
        "gastos": [{"concepto": m.concepto, "monto": m.monto, "observaciones": m.observaciones} for m in gastos],
    }


def historial_entregas(db, id_sesion, id_empleado=None):
    query = select(EntregaCobrador).where(EntregaCobrador.id_sesion == id_sesion)
    if id_empleado is not None:
        query = query.where(EntregaCobrador.id_empleado == id_empleado)
    return [detalle_entrega(db, e) for e in db.scalars(query.order_by(EntregaCobrador.id_entrega.desc())).all()]


def _firma_gastos(gastos):
    return sorted((g.concepto, _moneda(g.monto), g.observaciones or "") for g in gastos)


def registrar_entrega(db, data, id_receptor):
    """Confirma entrega neta y gastos una sola vez bajo el mismo bloqueo de Caja.

    La idempotencia se comprueba ANTES del estado de sesión o del pendiente:
    un reintento idéntico devuelve lo ya confirmado incluso tras cerrar Caja.
    """
    try:
        _bloquear_caja(db)
        existentes = list(db.scalars(select(EntregaCobrador)
            .where(EntregaCobrador.clave_idempotencia == data.clave_idempotencia)
            .with_for_update(of=EntregaCobrador)).all())
        if existentes:
            if len(existentes) != 1:
                raise EntregaInvalidaError("La clave identifica varias entregas; revise la integridad")
            entrega = existentes[0]
            detalles = list(db.scalars(select(EntregaPagoDetalle).where(EntregaPagoDetalle.id_entrega == entrega.id_entrega)).all())
            gastos = list(db.scalars(select(MovimientoCaja).where(MovimientoCaja.id_entrega_cobrador == entrega.id_entrega)).all())
            if (entrega.id_sesion != data.id_sesion or entrega.id_empleado != data.id_empleado
                or entrega.id_administrativo != id_receptor or entrega.monto_entregado != data.monto_entregado
                or entrega.observaciones != data.observaciones
                or sorted(d.id_pago for d in detalles) != sorted(data.ids_pagos)
                or _firma_gastos(gastos) != _firma_gastos(data.gastos)):
                raise EntregaInvalidaError("La clave de idempotencia ya se utilizó con otros datos")
            resultado = detalle_entrega(db, entrega)
            db.commit()
            return resultado
        sesion = _sesion_abierta(db, for_update=True)
        if sesion is None or sesion.id_sesion != data.id_sesion:
            raise EntregaInvalidaError("La entrega requiere la sesión de Caja abierta indicada")
        filas = _pagos_sesion(db, data.id_sesion, sorted(data.ids_pagos), bloquear=True)
        if len(filas) != len(data.ids_pagos):
            raise EntregaInvalidaError("Hay pagos inexistentes o pertenecientes a otra sesión")
        liquidado = _liquidaciones(db, data.ids_pagos)
        pendientes = []
        for row in filas:
            if (row.Pago.origen_financiero != "INTERNET"
                or row.Pago.id_empleado != data.id_empleado or row.Pago.recepcion_efectivo != "EMPLEADO"
                or not _es_efectivo(row.MetodoPago)):
                raise EntregaInvalidaError("Solo se entregan cobros de Internet en efectivo del empleado seleccionado")
            pendiente = _pago_pendiente(row, liquidado)["pendiente"]
            if pendiente <= CERO:
                raise EntregaInvalidaError("El pago ya fue liquidado; actualice los pendientes")
            pendientes.append((row.Pago.id_pago, pendiente))
        recaudado = sum((monto for _, monto in pendientes), CERO)
        total_gastos = sum((g.monto for g in data.gastos), CERO)
        if data.monto_entregado + total_gastos != recaudado:
            raise EntregaInvalidaError("Efectivo entregado + gastos autorizados debe coincidir con lo recaudado pendiente")
        if data.gastos and not data.autorizar_gastos:
            raise EntregaInvalidaError("El encargado debe autorizar los gastos", 422)
        categoria = metodo = None
        if data.gastos:
            categorias = list_categorias_manuales_activas(db, "Egreso")
            metodos = list(db.scalars(select(MetodoPago).where(MetodoPago.estado == "Activo",
                func.lower(func.trim(MetodoPago.nombre)) == "efectivo")).all())
            if len(categorias) != 1 or len(metodos) != 1:
                raise EntregaInvalidaError("Se requiere una categoría Salida y un método Efectivo activos")
            categoria, metodo = categorias[0], metodos[0]
        fecha = db.scalar(select(func.localtimestamp()))
        if fecha is None:
            raise RuntimeError("PostgreSQL no devolvió la fecha de recepción")
        entrega = EntregaCobrador(
            id_sesion=data.id_sesion, id_empleado=data.id_empleado, id_administrativo=id_receptor,
            clave_idempotencia=data.clave_idempotencia, monto_entregado=data.monto_entregado,
            fecha_hora=fecha, observaciones=data.observaciones,
        )
        db.add(entrega)
        db.flush()
        restante_gastos = total_gastos
        for identifier, pendiente in pendientes:
            gasto = min(pendiente, restante_gastos)
            restante_gastos -= gasto
            db.add(EntregaPagoDetalle(id_entrega=entrega.id_entrega, id_pago=identifier,
                id_empleado=data.id_empleado, monto_entregado=pendiente - gasto, monto_gasto_autorizado=gasto))
        for gasto in data.gastos:
            db.add(MovimientoCaja(id_sesion=data.id_sesion, id_categoria=categoria.id_categoria,
                id_metodo_pago=metodo.id_metodo_pago, id_responsable=id_receptor,
                id_entrega_cobrador=entrega.id_entrega, tipo="Egreso", origen_financiero=None,
                concepto=gasto.concepto, monto=gasto.monto, observaciones=gasto.observaciones,
                fecha_hora=fecha))
        db.flush()
        resultado = detalle_entrega(db, entrega)
        db.commit()
        return resultado
    except Exception:
        db.rollback()
        raise
