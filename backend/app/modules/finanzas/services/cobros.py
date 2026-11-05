"""Consultas y confirmacion transaccional del ciclo de cobros y pagos."""

from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from sqlalchemy import Select, and_, func, literal, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion, Proforma
from app.modules.cotizaciones.services.cotizaciones import calcular_totales
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.caja import CategoriaCaja, MovimientoCaja
from app.modules.finanzas.models.cobros import (
    Cobro,
    ComprobanteCobro,
    GestionCobro,
    MetodoPago,
    Pago,
    PagoDetalle,
)
from app.modules.finanzas.schemas.cobros import (
    AplicacionPagoCreate,
    DistribucionPagoCreate,
    GeneracionMensualidadesInternetCreate,
    RegistroPagoCreate,
    RegistroPendienteCreate,
)
from app.modules.finanzas.services.caja import (
    ESTADO_ACTIVO,
    TIPO_INGRESO,
    CategoriaCajaInvalidaError,
    MetodoPagoCajaInvalidoError,
    ReferenciaMovimientoRequeridaError,
    SesionCajaNoAbiertaError,
    _bloquear_caja,
    _es_efectivo,
    _sesion_abierta,
)
from app.modules.finanzas.services.cobros_instalaciones import (
    CotizacionInstalacionInvalidaError,
    InstalacionCobroInconsistenteError,
    obtener_o_crear_cobro_instalacion,
    resolver_cotizacion_instalacion,
)
from app.modules.finanzas.services.cobros_ordenes import (
    CotizacionOrdenInvalidaError,
    OrdenCobroInconsistenteError,
    enriquecer_cobros_orden,
    listar_cotizaciones_orden,
    obtener_o_crear_cobro_orden,
    resolver_cotizacion_orden,
    total_aplicado_cobro,
)
from app.modules.finanzas.services.comprobantes import (
    crear_comprobante_pago,
    eliminar_pdf_creado,
    ticket_response,
)
from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.visitas_tecnicas.models.evaluacion_visita import EvaluacionVisita
from app.modules.visitas_tecnicas.models.tipo_instalacion import TipoInstalacion
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")


class CobroNotFoundError(Exception):
    """La obligacion solicitada no existe."""


class SaldoCobroInconsistenteError(Exception):
    """Los pagos aplicados superan el monto registrado de una obligacion."""

    def __init__(
        self,
        id_cobro: int,
        monto: Decimal,
        total_pagado: Decimal,
    ) -> None:
        self.id_cobro = id_cobro
        self.monto = monto
        self.total_pagado = total_pagado
        super().__init__(f"Saldo inconsistente para el cobro {id_cobro}")


class MigracionFinancieraPendienteError(Exception):
    """La migracion 008 no esta aplicada de forma atomica en PostgreSQL."""


class OrigenPagoNoSoportadoError(Exception):
    """El origen aun no posee una entidad fuente verificable."""

    def __init__(self, origen_financiero: str) -> None:
        self.origen_financiero = origen_financiero
        super().__init__(f"Origen financiero no soportado: {origen_financiero}")


class ClientePagoNoEncontradoError(Exception):
    """El cliente indicado para el pago no existe."""


class FuentePagoNoVerificableError(Exception):
    """No existe una instalacion que respalde el origen del pago."""


class CobrosPagoNoEncontradosError(Exception):
    """Una o mas obligaciones incluidas en la distribucion no existen."""

    def __init__(self, ids_cobro: list[int]) -> None:
        self.ids_cobro = ids_cobro
        super().__init__("Cobros no encontrados")


class DistribucionPagoIncompatibleError(Exception):
    """La distribucion mezcla o contradice cliente y origen del pago."""


class RecepcionEfectivoInvalidaError(Exception):
    """No existe una identidad física válida o autorización de recepción en Caja."""

    def __init__(self, mensaje: str, status_code: int = 422):
        self.status_code = status_code
        super().__init__(mensaje)


class TipoPagoOrdenInvalidoError(Exception):
    """El tipo declarado no corresponde al importe pagado de la obligacion."""

    def __init__(self, tipo_pago: str, saldo: Decimal, monto: Decimal) -> None:
        self.tipo_pago = tipo_pago
        self.saldo = saldo
        self.monto = monto
        super().__init__("Tipo de pago incompatible con el saldo de la obligacion")


class SobrepagoCobroError(Exception):
    """Una aplicacion solicitada supera el saldo disponible de la obligacion."""

    def __init__(self, id_cobro: int, saldo: Decimal, solicitado: Decimal) -> None:
        self.id_cobro = id_cobro
        self.saldo = saldo
        self.solicitado = solicitado
        super().__init__(f"Sobrepago del cobro {id_cobro}")


class ClaveIdempotenciaEnConflictoError(Exception):
    """La clave ya identifica un pago con datos diferentes."""

    def __init__(self, id_pago: int | None = None) -> None:
        self.id_pago = id_pago
        super().__init__("La clave de idempotencia ya fue utilizada")


class PagoNoEncontradoError(Exception):
    """El pago anticipado que se desea distribuir no existe."""


class AplicacionPagoEnConflictoError(Exception):
    """La pareja pago-cobro ya fue aplicada con otros datos."""

    def __init__(self, id_cobro: int) -> None:
        self.id_cobro = id_cobro
        super().__init__(f"Aplicacion en conflicto para el cobro {id_cobro}")


class SaldoPagoInsuficienteError(Exception):
    """Las aplicaciones nuevas superan el saldo no distribuido del pago."""

    def __init__(self, disponible: Decimal, solicitado: Decimal) -> None:
        self.disponible = disponible
        self.solicitado = solicitado
        super().__init__("Saldo no distribuido insuficiente")


class SaldoPagoInconsistenteError(Exception):
    """Las aplicaciones persistidas ya superan el monto total del pago."""


class CobroInstalacionInconsistenteError(Exception):
    """La instalacion ya posee obligaciones financieras incompatibles."""


def _moneda(value: Decimal | int) -> Decimal:
    """Normaliza resultados SQL y operaciones de Decimal a dos decimales."""

    return Decimal(value).quantize(MONEDA, rounding=ROUND_HALF_UP)


def calcular_saldo(
    id_cobro: int,
    monto: Decimal,
    total_pagado: Decimal | int,
) -> tuple[Decimal, Decimal]:
    """Calcula el saldo sin ocultar sobrepagos como un saldo cero normal."""

    monto_normalizado = _moneda(monto)
    pagado_normalizado = _moneda(total_pagado)
    saldo = _moneda(monto_normalizado - pagado_normalizado)
    if saldo < CERO:
        raise SaldoCobroInconsistenteError(
            id_cobro,
            monto_normalizado,
            pagado_normalizado,
        )
    return pagado_normalizado, saldo


def _total_aplicado_subquery():
    """Suma aplicaciones por cobro; Pago.monto_total no sustituye este detalle."""

    cero_monetario = literal(CERO, type_=PagoDetalle.monto_aplicado.type)
    return (
        select(func.coalesce(func.sum(PagoDetalle.monto_aplicado), cero_monetario))
        .where(PagoDetalle.id_cobro == Cobro.id_cobro)
        .correlate(Cobro)
        .scalar_subquery()
    )


def _aplicar_filtros_cobros(
    query: Select[Any],
    *,
    estado: str | None,
    periodo: str | None,
    id_servicio: int | None,
    fecha_desde: date | None,
    fecha_hasta: date | None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> Select[Any]:
    """Aplica solo filtros respaldados por columnas reales de cobros."""

    if estado is not None:
        query = query.where(Cobro.estado == estado)
    if periodo is not None:
        query = query.where(Cobro.periodo == periodo)
    if id_servicio is not None:
        query = query.where(Cobro.id_servicio == id_servicio)
    if fecha_desde is not None:
        query = query.where(Cobro.fecha_emision >= fecha_desde)
    if fecha_hasta is not None:
        query = query.where(Cobro.fecha_emision <= fecha_hasta)
    if origenes_permitidos is not None:
        query = query.where(Cobro.origen_financiero.in_(origenes_permitidos))
    return query


def _parametros_pagina(total: int, page: int, page_size: int) -> dict[str, int]:
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


def _cobro_saldo_response(
    cobro: Cobro,
    total_aplicado: Decimal | int,
    *,
    cliente_nombres: str | None = None,
    cliente_apellidos: str | None = None,
    cliente_telefono: str | None = None,
    numero_cotizacion: str | None = None,
    id_proforma: int | None = None,
    tipo_instalacion: str | None = None,
    id_orden_trabajo: int | None = None,
    codigo_orden: str | None = None,
    tiene_comprobante: bool = False,
) -> dict[str, Any]:
    """Expone saldo y contexto comercial sin duplicarlos en la tabla cobros."""

    total_pagado, saldo_pendiente = calcular_saldo(
        cobro.id_cobro,
        cobro.monto,
        total_aplicado,
    )
    return {
        "id_cobro": cobro.id_cobro,
        "id_cliente": cobro.id_cliente,
        "origen_financiero": cobro.origen_financiero,
        "id_instalacion": cobro.id_instalacion,
        "id_servicio": cobro.id_servicio,
        "periodo": cobro.periodo,
        "fecha_emision": cobro.fecha_emision,
        "fecha_vencimiento": cobro.fecha_vencimiento,
        "monto": _moneda(cobro.monto),
        "estado": cobro.estado,
        "cliente_nombre": " ".join(
            parte.strip()
            for parte in (cliente_nombres or "", cliente_apellidos or "")
            if parte.strip()
        )
        or f"Cliente #{cobro.id_cliente}",
        "cliente_telefono": cliente_telefono,
        "numero_cotizacion": numero_cotizacion,
        "id_proforma": id_proforma,
        "tipo_instalacion": tipo_instalacion,
        "id_orden_trabajo": id_orden_trabajo,
        "codigo_orden": codigo_orden,
        "total_pagado": total_pagado,
        "saldo_pendiente": saldo_pendiente,
        "tiene_comprobante": tiene_comprobante,
    }


def _cobros_con_contexto_query(total_aplicado):
    """Une el documento y cliente verificables sin alterar la paginacion."""

    # EXISTS conserva una fila por cobro aunque un pago cubra varios períodos
    # o la mensualidad tenga varios comprobantes; no depende del saldo/estado.
    tiene_comprobante = (
        select(PagoDetalle.id_pago)
        .join(ComprobanteCobro, ComprobanteCobro.id_pago == PagoDetalle.id_pago)
        .where(PagoDetalle.id_cobro == Cobro.id_cobro)
        .correlate(Cobro)
        .exists()
    )
    return (
        select(
            Cobro,
            total_aplicado.label("total_aplicado"),
            tiene_comprobante.label("tiene_comprobante"),
            Cliente.nombres.label("cliente_nombres"),
            Cliente.apellidos.label("cliente_apellidos"),
            Cliente.telefono.label("cliente_telefono"),
            Cotizacion.numero_cotizacion.label("numero_cotizacion"),
            Proforma.id_proforma.label("id_proforma"),
            TipoInstalacion.nombre.label("tipo_instalacion"),
        )
        .join(Cliente, Cliente.id_cliente == Cobro.id_cliente)
        .outerjoin(
            Instalacion,
            and_(
                Instalacion.id_instalacion == Cobro.id_instalacion,
                Instalacion.id_cliente == Cobro.id_cliente,
            ),
        )
        .outerjoin(VisitaTecnica, VisitaTecnica.id_visita == Instalacion.id_visita)
        .outerjoin(
            EvaluacionVisita,
            EvaluacionVisita.id_visita == VisitaTecnica.id_visita,
        )
        # La cotizacion es la fuente financiera; la instalacion solo aporta
        # contexto tecnico cuando ya fue programada.
        .outerjoin(
            Cotizacion,
            and_(
                Cotizacion.id_cotizacion == Cobro.id_cotizacion,
                Cotizacion.origen == "EVALUACION",
            ),
        )
        .outerjoin(Proforma, Proforma.id_cotizacion == Cotizacion.id_cotizacion)
        .outerjoin(
            TipoInstalacion,
            TipoInstalacion.id_tipo_instalacion == VisitaTecnica.id_tipo_instalacion,
        )
    )


def _respuesta_cobro_contextual(row) -> dict[str, Any]:
    """Adapta una fila enriquecida y conserva pruebas con filas simplificadas."""

    return _cobro_saldo_response(
        row.Cobro,
        row.total_aplicado,
        cliente_nombres=getattr(row, "cliente_nombres", None),
        cliente_apellidos=getattr(row, "cliente_apellidos", None),
        cliente_telefono=getattr(row, "cliente_telefono", None),
        numero_cotizacion=getattr(row, "numero_cotizacion", None),
        id_proforma=getattr(row, "id_proforma", None),
        tipo_instalacion=getattr(row, "tipo_instalacion", None),
        tiene_comprobante=getattr(row, "tiene_comprobante", False),
    )


def list_metodos_pago_activos(db: Session) -> list[MetodoPago]:
    """Lista exclusivamente metodos cuyo estado almacenado es Activo."""

    return list(
        db.scalars(
            select(MetodoPago)
            .where(MetodoPago.estado == "Activo")
            .order_by(MetodoPago.nombre, MetodoPago.id_metodo_pago)
        ).all()
    )


def _fecha_emision_instalacion(db: Session, instalacion: Instalacion) -> date:
    """Usa la fecha real de finalizacion o la fecha vigente si aun no finaliza.

    Permite registrar anticipos de instalacion antes de completar el trabajo,
    conservando la fecha real de finalizacion cuando ya existe.
    """

    if instalacion.fecha_finalizacion is not None:
        return instalacion.fecha_finalizacion.date()
    return db.scalar(select(func.current_date()))


def generar_cobro_instalacion(
    db: Session,
    instalacion: Instalacion,
) -> Cobro | None:
    """Genera o reutiliza la obligacion valida de la instalacion.

    El llamador conserva bloqueada la instalacion. Si no existe cotizacion
    aceptada con proforma, no hay documento comercial suficiente para cobrar y
    se preserva el flujo previo de finalizacion. La obligacion puede generarse
    antes de finalizar el trabajo para admitir anticipos.
    """

    if instalacion.id_visita is None:
        return None

    cotizacion = db.scalar(
        select(Cotizacion)
        .join(
            EvaluacionVisita,
            EvaluacionVisita.id_evaluacion == Cotizacion.id_evaluacion,
        )
        .where(EvaluacionVisita.id_visita == instalacion.id_visita)
        .options(
            selectinload(Cotizacion.detalles),
            joinedload(Cotizacion.proforma),
        )
        # La cotizacion es el documento comun si dos instalaciones apuntan a
        # la misma visita; su bloqueo serializa la generacion de la obligacion.
        .with_for_update(of=Cotizacion)
    )
    if (
        cotizacion is None
        or cotizacion.origen != "EVALUACION"
        or cotizacion.estado not in ("ACEPTADA", "COMPLETADA")
        or cotizacion.proforma is None
    ):
        return None
    if cotizacion.id_cliente != instalacion.id_cliente:
        raise CobroInstalacionInconsistenteError

    _, _, _, total = calcular_totales(
        cotizacion.detalles,
        cotizacion.porcentaje_descuento,
    )
    if total <= CERO:
        return None

    # La cotizacion es la identidad financiera unica; la instalacion no se
    # usa como clave porque el primer pago puede ocurrir antes de programarla.
    try:
        return obtener_o_crear_cobro_instalacion(db, cotizacion, _moneda(total))
    except InstalacionCobroInconsistenteError as error:
        # Conserva el error historico de esta funcion para sus llamadores.
        raise CobroInstalacionInconsistenteError from error


def generar_mensualidades_internet(
    db: Session,
    data: GeneracionMensualidadesInternetCreate,
) -> dict[str, int | str]:
    """Genera una obligación por servicio elegible y período.

    El mes calendario de inicio es gratuito; una asignación solo resulta
    facturable en períodos cuyo primer día sea posterior a ``fecha_inicio``.
    La conexión usa ``READ COMMITTED``. El ``FOR UPDATE`` ordenado
    serializa solicitudes concurrentes sobre las mismas asignaciones; la
    consulta de duplicados se ejecuta después del bloqueo, como una sentencia
    nueva, para observar el commit de cualquier solicitud que haya esperado.
    """

    periodo = f"{data.anio:04d}-{data.mes:02d}"
    fecha_emision = date(data.anio, data.mes, 1)
    try:
        ids_cliente = list(
            db.scalars(
                select(ServicioAsignacionPlan.id_cliente)
                .where(
                    ServicioAsignacionPlan.estado == "Activo",
                    ServicioAsignacionPlan.dia_vencimiento.is_not(None),
                    ServicioAsignacionPlan.fecha_inicio < fecha_emision,
                )
                .distinct()
                .order_by(ServicioAsignacionPlan.id_cliente)
            ).all()
        )
        _bloquear_clientes(db, ids_cliente)
        asignaciones = list(
            db.scalars(
                select(ServicioAsignacionPlan)
                .where(
                    ServicioAsignacionPlan.estado == "Activo",
                    ServicioAsignacionPlan.dia_vencimiento.is_not(None),
                    ServicioAsignacionPlan.fecha_inicio < fecha_emision,
                )
                .order_by(ServicioAsignacionPlan.id_asignacion)
                .with_for_update(of=ServicioAsignacionPlan)
            ).all()
        )
        mensualidades, existentes = _resolver_mensualidades_internet(
            db,
            [(asignacion, periodo) for asignacion in asignaciones],
            bloquear_existentes=True,
        )
        db.commit()
        return {
            "periodo": periodo,
            "generadas": len(mensualidades),
            "existentes": len(existentes),
            "total_elegibles": len(asignaciones),
        }
    except Exception:
        db.rollback()
        raise


def _bloquear_clientes(db: Session, ids_cliente: list[int]) -> None:
    """Bloquea clientes en orden ascendente antes de sus servicios."""

    if not ids_cliente:
        return
    bloqueados = list(
        db.scalars(
            select(Cliente.id_cliente)
            .where(Cliente.id_cliente.in_(sorted(set(ids_cliente))))
            .order_by(Cliente.id_cliente)
            .with_for_update(of=Cliente)
        ).all()
    )
    if bloqueados != sorted(set(ids_cliente)):
        raise ClientePagoNoEncontradoError


def _crear_mensualidad_internet(
    asignacion: ServicioAsignacionPlan,
    periodo: str,
) -> Cobro:
    """Calcula emisión, vencimiento y monto de una mensualidad facturable."""

    anio, mes = (int(valor) for valor in periodo.split("-"))
    fecha_emision = date(anio, mes, 1)
    if asignacion.fecha_inicio >= fecha_emision or asignacion.dia_vencimiento is None:
        raise DistribucionPagoIncompatibleError
    ultimo_dia = monthrange(anio, mes)[1]
    return Cobro(
        id_cliente=asignacion.id_cliente,
        origen_financiero="INTERNET",
        id_instalacion=None,
        id_servicio=asignacion.id_asignacion,
        periodo=periodo,
        fecha_emision=fecha_emision,
        fecha_vencimiento=date(
            anio,
            mes,
            min(asignacion.dia_vencimiento, ultimo_dia),
        ),
        monto=_moneda(asignacion.costo_mensual),
        estado="Pendiente",
    )


def _resolver_mensualidades_internet(
    db: Session,
    solicitudes: list[tuple[ServicioAsignacionPlan, str]],
    *,
    bloquear_existentes: bool,
) -> tuple[list[Cobro], list[Cobro]]:
    """Reutiliza mensualidades únicas y crea faltantes sin confirmar la transacción."""

    if not solicitudes:
        return [], []
    condiciones = [
        and_(Cobro.id_servicio == asignacion.id_asignacion, Cobro.periodo == periodo)
        for asignacion, periodo in solicitudes
    ]
    encontrados = list(
        db.scalars(
            select(Cobro)
            .where(Cobro.origen_financiero == "INTERNET", or_(*condiciones))
            .order_by(Cobro.id_cobro)
        ).all()
    )
    por_periodo: dict[tuple[int, str], Cobro] = {}
    for cobro in encontrados:
        clave = (cobro.id_servicio, cobro.periodo)
        if clave in por_periodo:
            raise DistribucionPagoIncompatibleError
        por_periodo[clave] = cobro

    if bloquear_existentes and encontrados:
        ids_cobro = [cobro.id_cobro for cobro in encontrados]
        encontrados = list(
            db.scalars(
                select(Cobro)
                .where(Cobro.id_cobro.in_(ids_cobro))
                .order_by(Cobro.id_cobro)
                .with_for_update(of=Cobro)
            ).all()
        )
        if len(encontrados) != len(ids_cobro):
            raise DistribucionPagoIncompatibleError
        por_periodo = {(cobro.id_servicio, cobro.periodo): cobro for cobro in encontrados}

    nuevas: list[Cobro] = []
    existentes: list[Cobro] = []
    for asignacion, periodo in solicitudes:
        esperada = _crear_mensualidad_internet(asignacion, periodo)
        existente = por_periodo.get((asignacion.id_asignacion, periodo))
        if existente is None:
            nuevas.append(esperada)
            continue
        if (
            existente.id_cliente != esperada.id_cliente
            or _moneda(existente.monto) != esperada.monto
            or existente.fecha_emision != esperada.fecha_emision
            or existente.fecha_vencimiento != esperada.fecha_vencimiento
        ):
            raise DistribucionPagoIncompatibleError
        existentes.append(existente)
    if nuevas:
        db.add_all(nuevas)
    return nuevas, existentes


def _verificar_migracion_financiera(db: Session) -> None:
    """Usa marcadores atomicos de 008 antes de consultar columnas nuevas."""

    aplicada = db.scalar(
        text(
            """
            SELECT
                to_regclass('entrega_pago_detalles') IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = to_regclass('pagos')
                      AND conname = 'uq_pagos_clave_idempotencia'
                )
                AND EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = to_regclass('pagos')
                      AND conname = 'fk_pagos_movimiento_integridad'
                )
            """
        )
    )
    if aplicada is not True:
        raise MigracionFinancieraPendienteError


def _detalles_pago(db: Session, id_pago: int) -> list[PagoDetalle]:
    """Carga aplicaciones en orden estable para respuesta e idempotencia."""

    return list(
        db.scalars(
            select(PagoDetalle)
            .where(PagoDetalle.id_pago == id_pago)
            .order_by(PagoDetalle.id_cobro)
        ).all()
    )


def _pago_confirmado_response(
    pago: Pago,
    detalles: list[PagoDetalle],
    comprobante: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Serializa un pago confirmado sin depender de relaciones viewonly."""

    detalles_response = [
        {
            "id_pago": detalle.id_pago,
            "id_cobro": detalle.id_cobro,
            "id_cliente": detalle.id_cliente,
            "origen_financiero": detalle.origen_financiero,
            "concepto": detalle.concepto,
            "monto_aplicado": _moneda(detalle.monto_aplicado),
        }
        for detalle in sorted(detalles, key=lambda item: item.id_cobro)
    ]
    monto_aplicado = _moneda(
        sum(
            (detalle["monto_aplicado"] for detalle in detalles_response),
            start=CERO,
        )
    )
    monto_total = _moneda(pago.monto_total)
    return {
        "id_pago": pago.id_pago,
        "id_cliente": pago.id_cliente,
        "origen_financiero": pago.origen_financiero,
        "id_movimiento_caja": pago.id_movimiento_caja,
        "clave_idempotencia": pago.clave_idempotencia,
        "id_metodo_pago": pago.id_metodo_pago,
        "id_empleado": pago.id_empleado,
        "id_entrega": pago.id_entrega,
        "monto_total": monto_total,
        "tipo_pago": getattr(pago, "tipo_pago", None),
        "fecha_hora": pago.fecha_hora,
        "referencia": pago.referencia,
        "observaciones": pago.observaciones,
        "detalles": detalles_response,
        "monto_aplicado": monto_aplicado,
        "monto_no_aplicado": _moneda(monto_total - monto_aplicado),
        "comprobante": comprobante,
    }


def _reintento_coincide(
    db: Session,
    pago: Pago,
    detalles: list[PagoDetalle],
    data: RegistroPagoCreate,
    id_empleado: int,
) -> bool:
    """Valida la huella original aunque el anticipo se distribuya despues."""

    if data.periodos_internet:
        ids_cobro = [detalle.id_cobro for detalle in detalles]
        cobros_firma = list(
            db.scalars(
                select(Cobro).where(Cobro.id_cobro.in_(ids_cobro))
            ).all()
        )
        # En un pago mixto, ``aplicaciones`` ya identifica obligaciones
        # persistidas. Solo se comparan aquí los períodos que el servidor
        # resolvió desde ``periodos_internet``; de lo contrario un reintento
        # válido incluiría también los períodos de las aplicaciones normales.
        ids_aplicaciones = {
            aplicacion.id_cobro for aplicacion in data.aplicaciones
        }
        firma_periodos = {
            (cobro.id_servicio, cobro.periodo)
            for cobro in cobros_firma
            if cobro.id_cobro not in ids_aplicaciones
            and cobro.origen_financiero == "INTERNET"
            and cobro.id_servicio is not None
            and cobro.periodo is not None
        }
        periodos_solicitados = {
            (periodo.id_servicio, periodo.periodo)
            for periodo in data.periodos_internet
        }
        if firma_periodos != periodos_solicitados:
            return False

    firma_persistida = [
        (
            detalle.id_cobro,
            _moneda(detalle.monto_aplicado),
            detalle.concepto,
        )
        for detalle in sorted(detalles, key=lambda item: item.id_cobro)
    ]
    firma_solicitada = [
        (
            aplicacion.id_cobro,
            _moneda(aplicacion.monto_aplicado),
            aplicacion.concepto,
        )
        for aplicacion in sorted(data.aplicaciones, key=lambda item: item.id_cobro)
    ]
    return (
        pago.id_cliente == data.id_cliente
        and pago.origen_financiero == data.origen_financiero
        and pago.id_metodo_pago == data.id_metodo_pago
        and pago.id_empleado == id_empleado
        and _moneda(pago.monto_total) == _moneda(data.monto_total)
        and getattr(pago, "tipo_pago", None) == data.tipo_pago
        and pago.referencia == data.referencia
        and pago.observaciones == data.observaciones
        # Una distribucion posterior puede agregar detalles, pero nunca cambia
        # las aplicaciones incluidas en la confirmacion idempotente original.
        and all(item in firma_persistida for item in firma_solicitada)
    )


def _bloquear_cliente_y_fuente(
    db: Session,
    id_cliente: int,
    origen_financiero: str = "INSTALACIONES",
) -> None:
    """Bloquea al cliente y valida la fuente propia de cada origen."""

    _bloquear_clientes(db, [id_cliente])

    # La cotizacion u orden ya fueron resueltas y bloqueadas antes de llegar
    # aqui; ninguna de las dos fuentes exige una instalacion fisica existente.
    if origen_financiero in ("INTERNET", "ORDENES_TRABAJO", "INSTALACIONES"):
        return


def _cobro_fuente_verificable(cobro: Cobro) -> bool:
    """Exige la entidad fuente real que corresponde al origen del cobro."""

    if cobro.origen_financiero == "INTERNET":
        # Internet solo admite mensualidades generadas para un servicio y período.
        return cobro.id_servicio is not None and cobro.periodo is not None
    if cobro.origen_financiero == "INSTALACIONES":
        # Conserva cobros historicos ligados a una instalacion; las nuevas
        # obligaciones sin instalacion usan obligatoriamente id_cotizacion.
        return cobro.id_cotizacion is not None or cobro.id_instalacion is not None
    if cobro.origen_financiero == "ORDENES_TRABAJO":
        return cobro.id_orden_trabajo is not None
    return False


def _bloquear_cobros_pago(
    db: Session,
    data: RegistroPagoCreate,
) -> tuple[list[Cobro], dict[int, Decimal]]:
    """Bloquea obligaciones en orden y valida saldos contra aplicaciones previas."""

    ids_cobro = sorted(aplicacion.id_cobro for aplicacion in data.aplicaciones)
    if not ids_cobro:
        return [], {}

    cobros = _bloquear_cobros_por_ids(db, ids_cobro, data)
    rows = db.execute(
        select(
            PagoDetalle.id_cobro,
            func.sum(PagoDetalle.monto_aplicado),
        )
        .where(PagoDetalle.id_cobro.in_(ids_cobro))
        .group_by(PagoDetalle.id_cobro)
    ).all()
    total_previo = {id_cobro: _moneda(total) for id_cobro, total in rows}
    montos_solicitados = {
        aplicacion.id_cobro: _moneda(aplicacion.monto_aplicado)
        for aplicacion in data.aplicaciones
    }
    totales_finales: dict[int, Decimal] = {}
    for cobro in cobros:
        pagado, saldo = calcular_saldo(
            cobro.id_cobro,
            cobro.monto,
            total_previo.get(cobro.id_cobro, CERO),
        )
        solicitado = montos_solicitados[cobro.id_cobro]
        if solicitado > saldo:
            raise SobrepagoCobroError(cobro.id_cobro, saldo, solicitado)
        totales_finales[cobro.id_cobro] = _moneda(pagado + solicitado)
    return cobros, totales_finales


def _bloquear_cobros_por_ids(
    db: Session,
    ids_cobro: list[int],
    data: RegistroPagoCreate,
) -> list[Cobro]:
    """Bloquea obligaciones ascendentes y valida su propietario financiero."""

    ids_ordenados = sorted(set(ids_cobro))
    if not ids_ordenados:
        return []
    cobros = list(
        db.scalars(
            select(Cobro)
            .where(Cobro.id_cobro.in_(ids_ordenados))
            .order_by(Cobro.id_cobro)
            .with_for_update(of=Cobro)
        ).all()
    )
    cobros_por_id = {cobro.id_cobro: cobro for cobro in cobros}
    faltantes = [id_cobro for id_cobro in ids_ordenados if id_cobro not in cobros_por_id]
    if faltantes:
        raise CobrosPagoNoEncontradosError(faltantes)
    if any(
        cobro.id_cliente != data.id_cliente
        or cobro.origen_financiero != data.origen_financiero
        or not _cobro_fuente_verificable(cobro)
        for cobro in cobros
    ):
        raise DistribucionPagoIncompatibleError
    return cobros


def _preparar_periodos_pago(
    db: Session,
    data: RegistroPagoCreate,
) -> RegistroPagoCreate:
    """Resuelve períodos futuros y los aplica por todo su saldo pendiente."""

    if not data.periodos_internet:
        return data
    ids_servicio = sorted({periodo.id_servicio for periodo in data.periodos_internet})
    asignaciones = list(
        db.scalars(
            select(ServicioAsignacionPlan)
            .where(
                ServicioAsignacionPlan.id_asignacion.in_(ids_servicio),
                ServicioAsignacionPlan.id_cliente == data.id_cliente,
                ServicioAsignacionPlan.estado == "Activo",
                ServicioAsignacionPlan.dia_vencimiento.is_not(None),
            )
            .order_by(ServicioAsignacionPlan.id_asignacion)
            .with_for_update(of=ServicioAsignacionPlan)
        ).all()
    )
    por_servicio = {asignacion.id_asignacion: asignacion for asignacion in asignaciones}
    if set(por_servicio) != set(ids_servicio):
        raise DistribucionPagoIncompatibleError
    solicitudes = [
        (por_servicio[periodo.id_servicio], periodo.periodo)
        for periodo in data.periodos_internet
    ]
    nuevas, existentes = _resolver_mensualidades_internet(
        db,
        solicitudes,
        bloquear_existentes=False,
    )
    if nuevas:
        db.flush()
    cobros_periodo = {
        (cobro.id_servicio, cobro.periodo): cobro
        for cobro in [*existentes, *nuevas]
    }
    seleccionados = [
        cobros_periodo[(periodo.id_servicio, periodo.periodo)]
        for periodo in data.periodos_internet
    ]
    ids_periodo = {cobro.id_cobro for cobro in seleccionados}
    if ids_periodo.intersection(aplicacion.id_cobro for aplicacion in data.aplicaciones):
        raise DistribucionPagoIncompatibleError

    ids_totales = [
        *(aplicacion.id_cobro for aplicacion in data.aplicaciones),
        *ids_periodo,
    ]
    _bloquear_cobros_por_ids(db, ids_totales, data)
    rows = db.execute(
        select(PagoDetalle.id_cobro, func.sum(PagoDetalle.monto_aplicado))
        .where(PagoDetalle.id_cobro.in_(ids_periodo))
        .group_by(PagoDetalle.id_cobro)
    ).all()
    pagados = {id_cobro: _moneda(total) for id_cobro, total in rows}
    aplicaciones_periodo: list[AplicacionPagoCreate] = []
    for cobro in seleccionados:
        _, saldo = calcular_saldo(
            cobro.id_cobro,
            cobro.monto,
            pagados.get(cobro.id_cobro, CERO),
        )
        if saldo <= CERO:
            raise DistribucionPagoIncompatibleError
        aplicaciones_periodo.append(
            AplicacionPagoCreate(
                id_cobro=cobro.id_cobro,
                concepto=f"Internet {cobro.periodo}",
                monto_aplicado=saldo,
            )
        )
    aplicaciones = [*data.aplicaciones, *aplicaciones_periodo]
    total_aplicado = _moneda(
        sum((aplicacion.monto_aplicado for aplicacion in aplicaciones), start=CERO)
    )
    if total_aplicado != _moneda(data.monto_total):
        raise DistribucionPagoIncompatibleError
    return data.model_copy(update={"aplicaciones": aplicaciones})


def _integrity_constraint(error: IntegrityError) -> str | None:
    diagnostics = getattr(error.orig, "diag", None)
    return getattr(diagnostics, "constraint_name", None)


def _validar_tipo_pago(
    tipo_pago: str | None,
    saldo: Decimal,
    monto: Decimal,
) -> None:
    """Valida la clasificacion ANTICIPO, PENDIENTE o TOTAL frente al saldo.

    Se comparte entre Ordenes de Trabajo e Instalaciones para anticipo y total.
    PENDIENTE pertenece al registro de obligaciones y nunca crea un pago recibido.
    """

    if (
        tipo_pago == "PENDIENTE"
        or monto > saldo
        or (tipo_pago == "TOTAL" and monto != saldo)
        or (tipo_pago in ("ANTICIPO", "PENDIENTE") and monto >= saldo)
    ):
        raise TipoPagoOrdenInvalidoError(tipo_pago or "", saldo, monto)


def registrar_obligacion_pendiente(
    db: Session, data: RegistroPendienteCreate,
) -> dict[str, Any]:
    """Crea o reutiliza la deuda de una cotizacion sin registrar un pago.

    Reutiliza los bloqueos de cotizacion y cobro y su unicidad existente. No
    requiere Caja abierta ni crea Pago/PagoDetalle/MovimientoCaja. El registro
    pendiente completa la cotizacion sin dinero recibido ni liquidar la deuda;
    la orden tecnica solo se completa al confirmar su entrega.
    """

    try:
        _verificar_migracion_financiera(db)
        if data.origen_financiero == "ORDENES_TRABAJO":
            cotizacion, _, orden, total = resolver_cotizacion_orden(
                db, data.id_cotizacion, data.id_cliente,
            )
            cobro = obtener_o_crear_cobro_orden(db, cotizacion, orden, total)
        else:
            cotizacion, _, _, total = resolver_cotizacion_instalacion(
                db, data.id_cotizacion, data.id_cliente,
            )
            cobro = obtener_o_crear_cobro_instalacion(db, cotizacion, total)
        response = get_cobro(db, cobro.id_cobro)
        if response is None:
            raise CobroNotFoundError
        # Mantiene abonos existentes; nunca reabre obligaciones sin deuda.
        if response["saldo_pendiente"] <= CERO:
            if data.origen_financiero == "ORDENES_TRABAJO":
                raise CotizacionOrdenInvalidaError
            raise CotizacionInstalacionInvalidaError
        # COMPLETADA representa el registro en Cobros, incluso con Q0.00.
        # La fecha y el estado se confirman junto con la obligacion; no se toca la orden.
        if cotizacion.estado != "COMPLETADA":
            fecha = db.scalar(select(func.localtimestamp()))
            if fecha is None:
                raise RuntimeError("PostgreSQL no devolvio la fecha del registro pendiente")
            cotizacion.estado = "COMPLETADA"
            cotizacion.fecha_actualizacion = fecha
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


def _resolver_recepcion_pago(db, data, empleado, es_efectivo, puede_caja, responsable_actual):
    """Valida la custodia explícita; jamás infiere recepción física del aperturista."""

    if not es_efectivo:
        if data.recepcion_efectivo is not None or data.id_empleado_receptor is not None:
            raise RecepcionEfectivoInvalidaError("La recepción física solo corresponde a efectivo")
        return responsable_actual
    if data.recepcion_efectivo == "CAJA_GENERAL":
        if not puede_caja or empleado is None or empleado.estado != "Activo":
            raise RecepcionEfectivoInvalidaError("Solo un encargado autorizado puede recibir efectivo en Caja", 403)
        if data.id_empleado_receptor is not None:
            raise RecepcionEfectivoInvalidaError("La identidad de recepción en Caja proviene del usuario autenticado")
        return empleado.id_empleado
    if data.recepcion_efectivo != "EMPLEADO" or data.id_empleado_receptor is None:
        raise RecepcionEfectivoInvalidaError("Indique dónde se recibió el efectivo y quién lo recaudó")
    receptor = empleado if empleado is not None and empleado.id_empleado == data.id_empleado_receptor else db.get(Empleado, data.id_empleado_receptor)
    if receptor is None or receptor.estado != "Activo":
        raise RecepcionEfectivoInvalidaError("El cobrador físico debe ser un empleado activo")
    return receptor.id_empleado


def registrar_pago(
    db: Session,
    data: RegistroPagoCreate,
    empleado: Empleado | None,
    id_usuario_registro: int | None = None,
    puede_recibir_en_caja: bool = False,
) -> dict[str, Any]:
    """Confirma pago, aplicaciones e ingreso de Caja en una sola transaccion."""

    ruta_pdf_creada: Path | None = None
    try:
        _verificar_migracion_financiera(db)
        if data.origen_financiero not in ("INTERNET", "INSTALACIONES", "ORDENES_TRABAJO"):
            raise OrigenPagoNoSoportadoError(data.origen_financiero)
        if (
            data.origen_financiero == "INTERNET"
            and not data.aplicaciones
            and not data.periodos_internet
        ):
            raise DistribucionPagoIncompatibleError

        # El mismo advisory lock protege movimientos manuales y automaticos.
        _bloquear_caja(db)
        pago_existente = db.scalar(
            select(Pago)
            .where(Pago.clave_idempotencia == data.clave_idempotencia)
            .with_for_update(of=Pago)
        )
        if pago_existente is not None:
            detalles_existentes = _detalles_pago(db, pago_existente.id_pago)
            id_responsable = (
                empleado.id_empleado if empleado is not None else pago_existente.id_empleado
            )
            if data.recepcion_efectivo == "EMPLEADO":
                id_responsable = data.id_empleado_receptor
            if id_usuario_registro is not None and (
                pago_existente.id_usuario_registro != id_usuario_registro
                or pago_existente.recepcion_efectivo != data.recepcion_efectivo
            ):
                raise ClaveIdempotenciaEnConflictoError(pago_existente.id_pago)
            if data.recepcion_efectivo == "CAJA_GENERAL" and not puede_recibir_en_caja:
                raise RecepcionEfectivoInvalidaError("Se requiere autorización de Caja General", 403)
            if data.recepcion_efectivo == "CAJA_GENERAL" and data.id_empleado_receptor is not None:
                raise RecepcionEfectivoInvalidaError("La identidad de recepción en Caja proviene del usuario autenticado")
            if not _reintento_coincide(
                db,
                pago_existente,
                detalles_existentes,
                data,
                id_responsable,
            ):
                raise ClaveIdempotenciaEnConflictoError(pago_existente.id_pago)
            comprobante_response = None
            if pago_existente.origen_financiero == "INTERNET":
                comprobante, ticket, ruta_pdf_creada = crear_comprobante_pago(
                    db,
                    pago_existente,
                )
                comprobante_response = ticket_response(comprobante, ticket)
            response = _pago_confirmado_response(
                pago_existente,
                detalles_existentes,
                comprobante_response,
            )
            db.commit()
            return response

        sesion = _sesion_abierta(db, for_update=True)
        if sesion is None:
            raise SesionCajaNoAbiertaError
        # La sesión aporta la identidad laboral auditable del Administrador sin empleado.
        id_responsable = empleado.id_empleado if empleado is not None else sesion.id_empleado

        categoria = db.scalar(
            select(CategoriaCaja)
            .where(
                CategoriaCaja.origen_financiero == data.origen_financiero,
                CategoriaCaja.tipo == TIPO_INGRESO,
                CategoriaCaja.estado == ESTADO_ACTIVO,
            )
            .with_for_update(of=CategoriaCaja)
        )
        if categoria is None:
            raise CategoriaCajaInvalidaError

        metodo = db.scalar(
            select(MetodoPago)
            .where(MetodoPago.id_metodo_pago == data.id_metodo_pago)
            .with_for_update(of=MetodoPago)
        )
        if metodo is None or metodo.estado != ESTADO_ACTIVO:
            raise MetodoPagoCajaInvalidoError
        if not _es_efectivo(metodo) and data.referencia is None:
            raise ReferenciaMovimientoRequeridaError
        if data.origen_financiero == "INTERNET":
            id_responsable = _resolver_recepcion_pago(
                db, data, empleado, _es_efectivo(metodo), puede_recibir_en_caja, id_responsable,
            )

        cotizacion_orden = None
        cobro_orden = None
        cotizacion_instalacion = None
        if data.origen_financiero == "ORDENES_TRABAJO":
            if data.id_cotizacion is None:
                raise CotizacionOrdenInvalidaError
            cotizacion_orden, _, orden, total_orden = resolver_cotizacion_orden(
                db,
                data.id_cotizacion,
                data.id_cliente,
            )
            cobro_orden = obtener_o_crear_cobro_orden(
                db,
                cotizacion_orden,
                orden,
                total_orden,
            )
            pagado = total_aplicado_cobro(db, cobro_orden.id_cobro)
            saldo = _moneda(_moneda(cobro_orden.monto) - pagado)
            if saldo < CERO:
                raise SaldoCobroInconsistenteError(
                    cobro_orden.id_cobro,
                    cobro_orden.monto,
                    pagado,
                )
            monto_orden = _moneda(data.monto_total)
            _validar_tipo_pago(data.tipo_pago, saldo, monto_orden)
            if data.aplicaciones:
                if any(
                    aplicacion.id_cobro != cobro_orden.id_cobro
                    for aplicacion in data.aplicaciones
                ):
                    raise DistribucionPagoIncompatibleError
                total_solicitado = _moneda(
                    sum(
                        (
                            aplicacion.monto_aplicado
                            for aplicacion in data.aplicaciones
                        ),
                        start=CERO,
                    )
                )
                if total_solicitado != monto_orden:
                    raise DistribucionPagoIncompatibleError
            else:
                aplicado = min(_moneda(data.monto_total), saldo)
                aplicaciones = (
                    []
                    if aplicado <= CERO
                    else [
                        AplicacionPagoCreate(
                            id_cobro=cobro_orden.id_cobro,
                            concepto=f"Orden {orden.codigo}",
                            monto_aplicado=aplicado,
                        )
                    ]
                )
                data = data.model_copy(update={"aplicaciones": aplicaciones})

        # Instalaciones: la cotizacion EVALUACION aceptada con proforma permite
        # generar o reutilizar la obligacion aunque no exista instalacion.
        if data.origen_financiero == "INSTALACIONES" and data.id_cotizacion is not None:
            cotizacion_instalacion, _, _, total_instalacion = (
                resolver_cotizacion_instalacion(
                    db,
                    data.id_cotizacion,
                    data.id_cliente,
                )
            )
            cobro_instalacion = obtener_o_crear_cobro_instalacion(
                db,
                cotizacion_instalacion,
                total_instalacion,
            )
            pagado_instalacion = total_aplicado_cobro(db, cobro_instalacion.id_cobro)
            saldo_instalacion = _moneda(
                _moneda(cobro_instalacion.monto) - pagado_instalacion
            )
            if saldo_instalacion < CERO:
                raise SaldoCobroInconsistenteError(
                    cobro_instalacion.id_cobro,
                    cobro_instalacion.monto,
                    pagado_instalacion,
                )
            monto_instalacion = _moneda(data.monto_total)
            _validar_tipo_pago(data.tipo_pago, saldo_instalacion, monto_instalacion)
            if data.aplicaciones:
                if any(
                    aplicacion.id_cobro != cobro_instalacion.id_cobro
                    for aplicacion in data.aplicaciones
                ):
                    raise DistribucionPagoIncompatibleError
                total_solicitado = _moneda(
                    sum(
                        (
                            aplicacion.monto_aplicado
                            for aplicacion in data.aplicaciones
                        ),
                        start=CERO,
                    )
                )
                if total_solicitado != monto_instalacion:
                    raise DistribucionPagoIncompatibleError
            else:
                aplicado = min(monto_instalacion, saldo_instalacion)
                aplicaciones = (
                    []
                    if aplicado <= CERO
                    else [
                        AplicacionPagoCreate(
                            id_cobro=cobro_instalacion.id_cobro,
                            concepto=(
                                "Cotizacion "
                                f"{cotizacion_instalacion.numero_cotizacion}"
                            ),
                            monto_aplicado=aplicado,
                        )
                    ]
                )
                data = data.model_copy(update={"aplicaciones": aplicaciones})

            # El estado comercial se completa por el pago confirmado, no por
            # la finalizacion tecnica independiente de Instalaciones.
            cotizacion_instalacion.estado = "COMPLETADA"

        _bloquear_cliente_y_fuente(db, data.id_cliente, data.origen_financiero)
        if data.origen_financiero == "INTERNET":
            data = _preparar_periodos_pago(db, data)
        cobros, totales_finales = _bloquear_cobros_pago(db, data)

        fecha_hora = db.scalar(select(func.localtimestamp()))
        if fecha_hora is None:
            raise RuntimeError("PostgreSQL no devolvio la fecha del pago")

        monto_total = _moneda(data.monto_total)
        concepto_movimiento = (
            f"Pago de orden {orden.codigo}" if cobro_orden is not None
            else "Pago de Internet" if data.origen_financiero == "INTERNET"
            else "Pago de instalaciones"
        )
        movimiento = MovimientoCaja(
            id_sesion=sesion.id_sesion,
            id_categoria=categoria.id_categoria,
            id_metodo_pago=metodo.id_metodo_pago,
            id_responsable=id_responsable,
            tipo=TIPO_INGRESO,
            origen_financiero=data.origen_financiero,
            concepto=concepto_movimiento,
            monto=monto_total,
            referencia=data.referencia,
            id_salida_producto=None,
            observaciones=data.observaciones,
            fecha_hora=fecha_hora,
        )
        db.add(movimiento)
        db.flush()

        pago = Pago(
            id_cliente=data.id_cliente,
            origen_financiero=data.origen_financiero,
            id_movimiento_caja=movimiento.id_movimiento,
            clave_idempotencia=data.clave_idempotencia,
            id_metodo_pago=metodo.id_metodo_pago,
            id_empleado=id_responsable,
            # Los otros orígenes registran su ingreso sin abrir custodia por empleado.
            recepcion_efectivo=(
                data.recepcion_efectivo
                if data.origen_financiero == "INTERNET"
                else None
            ),
            id_usuario_registro=id_usuario_registro,
            id_entrega=None,
            monto_total=monto_total,
            tipo_pago=data.tipo_pago,
            fecha_hora=fecha_hora,
            referencia=data.referencia,
            observaciones=data.observaciones,
        )
        db.add(pago)
        db.flush()

        detalles = [
            PagoDetalle(
                id_pago=pago.id_pago,
                id_cobro=aplicacion.id_cobro,
                id_cliente=data.id_cliente,
                origen_financiero=data.origen_financiero,
                concepto=aplicacion.concepto,
                monto_aplicado=_moneda(aplicacion.monto_aplicado),
            )
            for aplicacion in sorted(
                data.aplicaciones,
                key=lambda item: item.id_cobro,
            )
        ]
        db.add_all(detalles)
        for cobro in cobros:
            if totales_finales[cobro.id_cobro] == _moneda(cobro.monto):
                cobro.estado = "Pagado"
        # El primer pago valido completa la cotizacion de la orden, incluso un
        # anticipo. La deuda depende de pago_detalles: no se liquida ni se cierra
        # la orden tecnica por este cambio. Cualquier fallo revierte todo junto.
        if cotizacion_orden is not None and cotizacion_orden.estado != "COMPLETADA":
            cotizacion_orden.estado = "COMPLETADA"
            cotizacion_orden.fecha_actualizacion = fecha_hora
        db.flush()

        comprobante_response = None
        if data.origen_financiero == "INTERNET":
            comprobante, ticket, ruta_pdf_creada = crear_comprobante_pago(db, pago)
            comprobante_response = ticket_response(comprobante, ticket)
        response = _pago_confirmado_response(
            pago,
            detalles,
            comprobante_response,
        )
        db.commit()
        return response
    except IntegrityError as error:
        constraint_name = _integrity_constraint(error)
        db.rollback()
        eliminar_pdf_creado(ruta_pdf_creada)
        if constraint_name == "uq_pagos_clave_idempotencia":
            raise ClaveIdempotenciaEnConflictoError from None
        if constraint_name == "uq_cobros_orden_trabajo":
            raise OrdenCobroInconsistenteError from None
        if constraint_name == "uq_cobros_instalaciones_cotizacion":
            raise InstalacionCobroInconsistenteError from None
        raise
    except Exception:
        db.rollback()
        eliminar_pdf_creado(ruta_pdf_creada)
        raise


def distribuir_pago(
    db: Session,
    id_pago: int,
    data: DistribucionPagoCreate,
) -> dict[str, Any]:
    """Consume saldo anticipado sin crear un segundo ingreso en Caja."""

    ruta_pdf_creada: Path | None = None
    try:
        _verificar_migracion_financiera(db)
        pago = db.scalar(
            select(Pago)
            .where(Pago.id_pago == id_pago)
            .with_for_update(of=Pago)
        )
        if pago is None:
            raise PagoNoEncontradoError
        if pago.origen_financiero not in ("INSTALACIONES", "ORDENES_TRABAJO"):
            raise OrigenPagoNoSoportadoError(pago.origen_financiero)

        if data.id_cotizacion is not None and pago.origen_financiero in (
            "ORDENES_TRABAJO",
            "INSTALACIONES",
        ):
            if pago.origen_financiero == "ORDENES_TRABAJO":
                cotizacion_orden, _, orden, total_orden = resolver_cotizacion_orden(
                    db,
                    data.id_cotizacion,
                    pago.id_cliente,
                )
                cobro_orden = obtener_o_crear_cobro_orden(
                    db,
                    cotizacion_orden,
                    orden,
                    total_orden,
                )
            else:
                # La distribucion de un anticipo de instalacion puede crear la
                # obligacion si aun no existe, reutilizando su cotizacion.
                cotizacion_instalacion, _, _, total_instalacion = (
                    resolver_cotizacion_instalacion(
                    db,
                    data.id_cotizacion,
                    pago.id_cliente,
                    )
                )
                cobro_orden = obtener_o_crear_cobro_instalacion(
                    db,
                    cotizacion_instalacion,
                    total_instalacion,
                )
            if any(
                aplicacion.id_cobro != cobro_orden.id_cobro
                for aplicacion in data.aplicaciones
            ):
                raise DistribucionPagoIncompatibleError
        else:
            cotizacion_orden = None
            cobro_orden = None

        detalles_existentes = _detalles_pago(db, pago.id_pago)
        detalles_por_cobro = {
            detalle.id_cobro: detalle for detalle in detalles_existentes
        }
        aplicaciones_nuevas = []
        for aplicacion in sorted(data.aplicaciones, key=lambda item: item.id_cobro):
            existente = detalles_por_cobro.get(aplicacion.id_cobro)
            if existente is None:
                aplicaciones_nuevas.append(aplicacion)
                continue
            if (
                _moneda(existente.monto_aplicado)
                != _moneda(aplicacion.monto_aplicado)
                or existente.concepto != aplicacion.concepto
            ):
                raise AplicacionPagoEnConflictoError(aplicacion.id_cobro)

        ids_cobro = sorted(aplicacion.id_cobro for aplicacion in data.aplicaciones)
        cobros = list(
            db.scalars(
                select(Cobro)
                .where(Cobro.id_cobro.in_(ids_cobro))
                .order_by(Cobro.id_cobro)
                .with_for_update(of=Cobro)
            ).all()
        )
        cobros_por_id = {cobro.id_cobro: cobro for cobro in cobros}
        faltantes = [id_cobro for id_cobro in ids_cobro if id_cobro not in cobros_por_id]
        if faltantes:
            raise CobrosPagoNoEncontradosError(faltantes)
        if any(
            cobro.id_cliente != pago.id_cliente
            or cobro.origen_financiero != pago.origen_financiero
            or not _cobro_fuente_verificable(cobro)
            for cobro in cobros
        ):
            raise DistribucionPagoIncompatibleError

        monto_aplicado_actual = _moneda(
            sum(
                (detalle.monto_aplicado for detalle in detalles_existentes),
                start=CERO,
            )
        )
        monto_disponible = _moneda(_moneda(pago.monto_total) - monto_aplicado_actual)
        if monto_disponible < CERO:
            raise SaldoPagoInconsistenteError
        monto_nuevo = _moneda(
            sum(
                (aplicacion.monto_aplicado for aplicacion in aplicaciones_nuevas),
                start=CERO,
            )
        )
        if monto_nuevo > monto_disponible:
            raise SaldoPagoInsuficienteError(monto_disponible, monto_nuevo)

        ids_nuevos = [aplicacion.id_cobro for aplicacion in aplicaciones_nuevas]
        rows = []
        if ids_nuevos:
            rows = db.execute(
                select(
                    PagoDetalle.id_cobro,
                    func.sum(PagoDetalle.monto_aplicado),
                )
                .where(PagoDetalle.id_cobro.in_(ids_nuevos))
                .group_by(PagoDetalle.id_cobro)
            ).all()
        total_previo = {id_cobro: _moneda(total) for id_cobro, total in rows}

        nuevos_detalles: list[PagoDetalle] = []
        for aplicacion in aplicaciones_nuevas:
            cobro = cobros_por_id[aplicacion.id_cobro]
            pagado, saldo = calcular_saldo(
                cobro.id_cobro,
                cobro.monto,
                total_previo.get(cobro.id_cobro, CERO),
            )
            solicitado = _moneda(aplicacion.monto_aplicado)
            if solicitado > saldo:
                raise SobrepagoCobroError(cobro.id_cobro, saldo, solicitado)
            if _moneda(pagado + solicitado) == _moneda(cobro.monto):
                cobro.estado = "Pagado"
            nuevos_detalles.append(
                PagoDetalle(
                    id_pago=pago.id_pago,
                    id_cobro=aplicacion.id_cobro,
                    id_cliente=pago.id_cliente,
                    origen_financiero=pago.origen_financiero,
                    concepto=aplicacion.concepto,
                    monto_aplicado=solicitado,
                )
            )

        if nuevos_detalles:
            db.add_all(nuevos_detalles)
            db.flush()
        # La proforma es el documento de entrega de proyectos; no se emite PDF.
        comprobante_response = None
        response = _pago_confirmado_response(
            pago,
            [*detalles_existentes, *nuevos_detalles],
            comprobante_response,
        )
        db.commit()
        return response
    except IntegrityError as error:
        constraint_name = _integrity_constraint(error)
        db.rollback()
        eliminar_pdf_creado(ruta_pdf_creada)
        if constraint_name == "pk_pago_detalles":
            raise AplicacionPagoEnConflictoError(-1) from None
        if constraint_name == "uq_cobros_orden_trabajo":
            raise OrdenCobroInconsistenteError from None
        raise
    except Exception:
        db.rollback()
        eliminar_pdf_creado(ruta_pdf_creada)
        raise


def list_pagos_con_saldo(
    db: Session,
    *,
    id_cliente: int,
    origen_financiero: str,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    """Pagina anticipos calculados sin reservar ni modificar su saldo."""

    cero_monetario = literal(CERO, type_=PagoDetalle.monto_aplicado.type)
    aplicaciones = (
        select(
            PagoDetalle.id_pago.label("id_pago"),
            func.sum(PagoDetalle.monto_aplicado).label("monto_aplicado"),
        )
        .group_by(PagoDetalle.id_pago)
        .subquery()
    )
    monto_aplicado = func.coalesce(aplicaciones.c.monto_aplicado, cero_monetario)
    filtros = (
        Pago.id_cliente == id_cliente,
        Pago.origen_financiero == origen_financiero,
    )

    inconsistente = db.execute(
        select(Pago.id_pago, monto_aplicado.label("monto_aplicado"))
        .outerjoin(aplicaciones, aplicaciones.c.id_pago == Pago.id_pago)
        .where(*filtros, monto_aplicado > Pago.monto_total)
        .limit(1)
    ).first()
    if inconsistente is not None:
        raise SaldoPagoInconsistenteError

    con_saldo = (*filtros, monto_aplicado < Pago.monto_total)
    total = int(
        db.scalar(
            select(func.count())
            .select_from(Pago)
            .outerjoin(aplicaciones, aplicaciones.c.id_pago == Pago.id_pago)
            .where(*con_saldo)
        )
        or 0
    )
    rows = db.execute(
        select(
            Pago,
            MetodoPago.nombre.label("metodo_pago"),
            monto_aplicado.label("monto_aplicado"),
        )
        .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
        .outerjoin(aplicaciones, aplicaciones.c.id_pago == Pago.id_pago)
        .where(*con_saldo)
        .order_by(Pago.fecha_hora.desc(), Pago.id_pago.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {
                "id_pago": row.Pago.id_pago,
                "id_cliente": row.Pago.id_cliente,
                "origen_financiero": row.Pago.origen_financiero,
                "fecha_hora": row.Pago.fecha_hora,
                "id_metodo_pago": row.Pago.id_metodo_pago,
                "metodo_pago": row.metodo_pago,
                "monto_total": _moneda(row.Pago.monto_total),
                "tipo_pago": getattr(row.Pago, "tipo_pago", None),
                "monto_aplicado": _moneda(row.monto_aplicado),
                "monto_no_aplicado": _moneda(
                    _moneda(row.Pago.monto_total) - _moneda(row.monto_aplicado)
                ),
                "referencia": row.Pago.referencia,
                "observaciones": row.Pago.observaciones,
            }
            for row in rows
        ],
        **_parametros_pagina(total, page, page_size),
    }


def _buscar_inconsistencia(
    db: Session,
    *,
    estado: str | None,
    periodo: str | None,
    id_servicio: int | None,
    fecha_desde: date | None,
    fecha_hasta: date | None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> None:
    """Impide presentar como normal un conjunto que contiene sobrepagos."""

    total_aplicado = _total_aplicado_subquery()
    query = select(Cobro, total_aplicado.label("total_aplicado"))
    query = _aplicar_filtros_cobros(
        query,
        estado=estado,
        periodo=periodo,
        id_servicio=id_servicio,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        origenes_permitidos=origenes_permitidos,
    ).where(total_aplicado > Cobro.monto)
    row = db.execute(query.limit(1)).first()
    if row is not None:
        calcular_saldo(row.Cobro.id_cobro, row.Cobro.monto, row.total_aplicado)


def list_cobros(
    db: Session,
    *,
    page: int,
    page_size: int,
    estado: str | None = None,
    periodo: str | None = None,
    id_servicio: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    solo_pendientes: bool = False,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Pagina obligaciones y calcula saldos desde pago_detalles con Decimal."""

    filtros = {
        "estado": estado,
        "periodo": periodo,
        "id_servicio": id_servicio,
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
        "origenes_permitidos": origenes_permitidos,
    }
    _buscar_inconsistencia(db, **filtros)

    total_aplicado = _total_aplicado_subquery()
    count_query = _aplicar_filtros_cobros(
        select(func.count()).select_from(Cobro), **filtros
    )
    items_query = _aplicar_filtros_cobros(
        _cobros_con_contexto_query(total_aplicado), **filtros
    )
    if solo_pendientes:
        count_query = count_query.where(total_aplicado < Cobro.monto)
        items_query = items_query.where(total_aplicado < Cobro.monto)

    total = int(db.scalar(count_query) or 0)
    rows = db.execute(
        items_query.order_by(Cobro.fecha_emision.desc(), Cobro.id_cobro.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = [_respuesta_cobro_contextual(row) for row in rows]
    return {
        "items": enriquecer_cobros_orden(db, items),
        **_parametros_pagina(total, page, page_size),
    }


def get_cobro(
    db: Session,
    id_cobro: int,
    *,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> dict[str, Any] | None:
    """Obtiene una obligacion y su saldo calculado, sin relaciones inferidas."""

    total_aplicado = _total_aplicado_subquery()
    query = _cobros_con_contexto_query(total_aplicado).where(Cobro.id_cobro == id_cobro)
    if origenes_permitidos is not None:
        query = query.where(Cobro.origen_financiero.in_(origenes_permitidos))
    row = db.execute(query).one_or_none()
    if row is None:
        return None
    items = enriquecer_cobros_orden(db, [_respuesta_cobro_contextual(row)])
    return items[0]


def list_pagos_aplicados(
    db: Session,
    id_cobro: int,
    *,
    page: int,
    page_size: int,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Pagina pagos unidos al cobro exclusivamente mediante pago_detalles."""

    if db.scalar(select(Cobro.id_cobro).where(Cobro.id_cobro == id_cobro)) is None:
        raise CobroNotFoundError

    filters = [PagoDetalle.id_cobro == id_cobro]
    if origenes_permitidos is not None:
        filters.append(Pago.origen_financiero.in_(origenes_permitidos))
    if fecha_desde is not None:
        filters.append(Pago.fecha_hora >= datetime.combine(fecha_desde, time.min))
    if fecha_hasta is not None:
        filters.append(Pago.fecha_hora <= datetime.combine(fecha_hasta, time.max))

    total = int(
        db.scalar(
            select(func.count())
            .select_from(PagoDetalle)
            .join(Pago, Pago.id_pago == PagoDetalle.id_pago)
            .where(*filters)
        )
        or 0
    )
    rows = db.execute(
        select(PagoDetalle, Pago, MetodoPago.nombre.label("metodo_pago"))
        .join(Pago, Pago.id_pago == PagoDetalle.id_pago)
        .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
        .where(*filters)
        .order_by(Pago.fecha_hora.desc(), Pago.id_pago.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {
                "id_pago": row.Pago.id_pago,
                "id_cobro": row.PagoDetalle.id_cobro,
                "id_cliente": row.Pago.id_cliente,
                "origen_financiero": row.Pago.origen_financiero,
                "id_movimiento_caja": row.Pago.id_movimiento_caja,
                "clave_idempotencia": row.Pago.clave_idempotencia,
                "fecha_hora": row.Pago.fecha_hora,
                "monto_total_pago": _moneda(row.Pago.monto_total),
                "monto_aplicado": _moneda(row.PagoDetalle.monto_aplicado),
                "concepto": row.PagoDetalle.concepto,
                "id_metodo_pago": row.Pago.id_metodo_pago,
                "metodo_pago": row.metodo_pago,
                "id_empleado": row.Pago.id_empleado,
                "referencia": row.Pago.referencia,
                "observaciones": row.Pago.observaciones,
            }
            for row in rows
        ],
        **_parametros_pagina(total, page, page_size),
    }


def list_historial_cobros(
    db: Session,
    *,
    page: int,
    page_size: int,
    id_cobro: int | None = None,
    resultado: str | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Pagina las gestiones de cobro registradas y permite filtros verificables."""

    filters = []
    if id_cobro is not None:
        filters.append(GestionCobro.id_cobro == id_cobro)
    if resultado is not None:
        filters.append(GestionCobro.resultado == resultado)
    if fecha_desde is not None:
        filters.append(
            GestionCobro.fecha_hora >= datetime.combine(fecha_desde, time.min)
        )
    if fecha_hasta is not None:
        filters.append(
            GestionCobro.fecha_hora <= datetime.combine(fecha_hasta, time.max)
        )

    total_query = select(func.count()).select_from(GestionCobro)
    items_query = select(GestionCobro)
    if origenes_permitidos is not None:
        total_query = total_query.join(Cobro, Cobro.id_cobro == GestionCobro.id_cobro)
        items_query = items_query.join(Cobro, Cobro.id_cobro == GestionCobro.id_cobro)
        filters.append(Cobro.origen_financiero.in_(origenes_permitidos))
    total = int(db.scalar(total_query.where(*filters)) or 0)
    items = db.scalars(
        items_query
        .where(*filters)
        .order_by(GestionCobro.fecha_hora.desc(), GestionCobro.id_gestion.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": list(items),
        **_parametros_pagina(total, page, page_size),
    }
