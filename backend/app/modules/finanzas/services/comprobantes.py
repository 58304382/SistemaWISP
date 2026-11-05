"""Comprobantes persistentes de pagos: numeracion, PDF y consultas.

La tabla ``comprobantes_cobro`` ya existe en PostgreSQL y no se modifica. La
numeracion consecutiva se serializa con un advisory lock transaccional para
evitar duplicados aun cuando existan varios procesos de FastAPI.
"""

from dataclasses import dataclass
from datetime import date, datetime
from calendar import monthrange
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from io import BytesIO
import os
import re
from typing import Any
from uuid import uuid4

from reportlab.lib.pagesizes import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from sqlalchemy import Select, func, select, text
from sqlalchemy.orm import Session

from app.modules.clientes.models.cliente import Cliente
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.models.cobros import (
    Cobro,
    ComprobanteCobro,
    MetodoPago,
    Pago,
    PagoDetalle,
)
from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.planes.models.plan import Plan
from app.modules.finanzas.services.comprobante_configuracion import (
    get_active_configuration as get_active_receipt_configuration,
)
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.visitas_tecnicas.models.tipo_instalacion import TipoInstalacion
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica
from app.services.image_uploads import BACKEND_ROOT, UPLOADS_ROOT


MONEDA = Decimal("0.01")
CERO = Decimal("0.00")
PREFIJO_NUMERO = "COB-"
MAXIMO_NUMERO = 999_999
ANCHO_PDF = 58 * mm
MARGEN_PDF = 5 * mm
CLAVE_BLOQUEO_NUMERACION = "sistemawisp:comprobantes-cobro:numeracion"
DIRECTORIO_COMPROBANTES = "comprobantes_cobro"
AGRADECIMIENTO = "¡Gracias por su preferencia!"
LEYENDA_FISCAL = "No constituye comprobante fiscal."
EMPRESA_NOMBRE = "Multiservicios Tale"
# La descripción es un texto preparado para la futura configuración del recibo;
# hoy se conserva como valor por defecto sin modificar tablas ni formularios.
EMPRESA_DESCRIPCION = "Servicios de Internet y telecomunicaciones"
ETIQUETAS_ORIGEN = {
    "INTERNET": "Servicios de Internet",
    "INSTALACIONES": "Instalaciones",
    "ORDENES_TRABAJO": "Órdenes de trabajo",
}


class ComprobantePdfNoDisponibleError(Exception):
    """El comprobante no tiene un archivo PDF verificable en disco."""


class ComprobantePdfAlmacenamientoError(Exception):
    """No fue posible generar o guardar el PDF del comprobante."""


class ComprobanteNumeracionAgotadaError(Exception):
    """La numeracion consecutiva alcanzo su limite de seis digitos."""


class ComprobanteInconsistenteError(Exception):
    """Los importes aplicados contradicen el monto real del pago."""


@dataclass(frozen=True)
class ConceptoTicket:
    """Concepto aplicado al pago, tal como se presenta en el ticket."""

    descripcion: str
    periodo: str | None
    monto: Decimal


@dataclass(frozen=True)
class TicketComprobante:
    """Datos autoritativos de presentacion de un comprobante de cobro."""

    numero: str
    fecha_emision: date
    fecha_hora: datetime
    id_pago: int
    id_cliente: int
    cliente_nombre: str
    cliente_telefono: str | None
    origen_financiero: str
    servicio: str
    periodo: str | None
    metodo_pago: str
    responsable: str
    subtotal: Decimal
    descuento: Decimal
    total: Decimal
    saldo_a_favor: Decimal
    conceptos: tuple[ConceptoTicket, ...]
    archivo_pdf: str | None
    # Datos preparados para la configuración futura del comprobante. Los
    # valores por defecto permiten conservar los comprobantes ya emitidos.
    empresa_nombre: str = EMPRESA_NOMBRE
    empresa_descripcion: str = EMPRESA_DESCRIPCION
    empresa_direccion: str | None = None
    empresa_telefono: str | None = None
    empresa_logo_url: str | None = None
    periodos: tuple[str, ...] = ()
    proxima_fecha_pago: date | None = None
    agradecimiento: str = AGRADECIMIENTO
    nota_fiscal: str = LEYENDA_FISCAL


def _moneda(value: Decimal | int) -> Decimal:
    return Decimal(value).quantize(MONEDA, rounding=ROUND_HALF_UP)


def _nombre_completo(nombres: str | None, apellidos: str | None) -> str:
    return " ".join(
        parte.strip() for parte in (nombres or "", apellidos or "") if parte.strip()
    )


def _etiqueta_origen(origen: str) -> str:
    return ETIQUETAS_ORIGEN.get(origen, origen.replace("_", " ").title())


def _texto_concepto(cobro: Cobro | None, tipo_instalacion: str | None) -> str:
    """Describe la obligacion sin inventar datos de servicio no existentes."""

    if cobro is None:
        return "Pago aplicado"
    if cobro.id_instalacion is not None:
        base = f"Instalación #{cobro.id_instalacion}"
    elif cobro.id_servicio is not None:
        base = f"Servicio #{cobro.id_servicio}"
    else:
        base = f"Cobro #{cobro.id_cobro}"
    return f"{tipo_instalacion} · {base}" if tipo_instalacion else base


def _etiqueta_plan(nombre: str, velocidad: str) -> str:
    """Presenta el nombre y la velocidad exactamente asociados al plan real."""

    return f"{nombre.strip()} · {velocidad.strip()}"


def _tipo_instalacion(db: Session, cobro: Cobro | None) -> str | None:
    """Obtiene el tipo real de instalacion solo cuando la cadena existe."""

    if cobro is None or cobro.id_instalacion is None:
        return None
    instalacion = db.get(Instalacion, cobro.id_instalacion)
    if instalacion is None or instalacion.id_visita is None:
        return None
    visita = db.get(VisitaTecnica, instalacion.id_visita)
    if visita is None or visita.id_tipo_instalacion is None:
        return None
    tipo = db.get(TipoInstalacion, visita.id_tipo_instalacion)
    return None if tipo is None else tipo.nombre


def _siguiente_periodo(periodo: str) -> str:
    """Devuelve el período mensual inmediatamente posterior en formato YYYY-MM."""

    anio, mes = (int(valor) for valor in periodo.split("-"))
    if mes == 12:
        return f"{anio + 1:04d}-01"
    return f"{anio:04d}-{mes + 1:02d}"


def _fecha_vencimiento_periodo(periodo: str, dia: int) -> date:
    """Ajusta el día configurado al último día real del mes."""

    anio, mes = (int(valor) for valor in periodo.split("-"))
    return date(anio, mes, min(dia, monthrange(anio, mes)[1]))


def _construir_ticket(
    db: Session,
    pago: Pago,
    *,
    numero: str,
    archivo_pdf: str | None,
) -> TicketComprobante:
    """Construye el ticket con datos reales del pago y sus aplicaciones."""

    cliente = db.get(Cliente, pago.id_cliente)
    metodo = db.get(MetodoPago, pago.id_metodo_pago)
    empleado = db.get(Empleado, pago.id_empleado)
    detalles = list(
        db.scalars(
            select(PagoDetalle)
            .where(PagoDetalle.id_pago == pago.id_pago)
            .order_by(PagoDetalle.id_cobro)
        ).all()
    )

    obligaciones: list[tuple[PagoDetalle, Cobro | None, str | None]] = []
    tipos: list[str] = []
    periodos: list[str] = []
    dias_por_periodo: dict[str, int] = {}
    for detalle in detalles:
        cobro = db.get(Cobro, detalle.id_cobro)
        tipo = _tipo_instalacion(db, cobro)
        obligaciones.append((detalle, cobro, tipo))
        if tipo is not None:
            tipos.append(tipo)
        if cobro is not None and cobro.periodo:
            periodos.append(cobro.periodo)
            if cobro.fecha_vencimiento is not None:
                dias_por_periodo[cobro.periodo] = cobro.fecha_vencimiento.day
    # Resuelve cada asignación contra su cliente y plan reales sin confiar en
    # el identificador legado de servicio como una FK de PostgreSQL.
    ids_servicio = sorted(
        {
            cobro.id_servicio
            for _, cobro, _ in obligaciones
            if cobro is not None and cobro.id_servicio is not None
        }
    )
    planes_por_servicio: dict[int, str] = {}
    if ids_servicio:
        filas_plan = db.execute(
            select(
                ServicioAsignacionPlan.id_asignacion,
                Plan.nombre,
                Plan.velocidad,
            )
            .join(Plan, Plan.id == ServicioAsignacionPlan.id_plan)
            .where(
                ServicioAsignacionPlan.id_asignacion.in_(ids_servicio),
                ServicioAsignacionPlan.id_cliente == pago.id_cliente,
            )
            .order_by(ServicioAsignacionPlan.id_asignacion)
        ).all()
        planes_por_servicio = {
            id_asignacion: _etiqueta_plan(nombre, velocidad)
            for id_asignacion, nombre, velocidad in filas_plan
        }

    conceptos: list[ConceptoTicket] = []
    servicios: list[str] = []
    subtotal = CERO
    for detalle, cobro, tipo in obligaciones:
        monto = _moneda(detalle.monto_aplicado)
        subtotal += monto
        plan = (
            None
            if cobro is None or cobro.id_servicio is None
            else planes_por_servicio.get(cobro.id_servicio)
        )
        descripcion = plan or _texto_concepto(cobro, tipo)
        if plan and plan not in servicios:
            servicios.append(plan)
        conceptos.append(
            ConceptoTicket(
                descripcion=descripcion,
                periodo=None if cobro is None else cobro.periodo,
                monto=monto,
            )
        )

    subtotal = _moneda(subtotal)
    total = _moneda(pago.monto_total)
    saldo_a_favor = _moneda(total - subtotal)
    if saldo_a_favor < CERO:
        raise ComprobanteInconsistenteError

    servicio = ", ".join(servicios) or (
        tipos[0] if tipos and len(set(tipos)) == 1 else _etiqueta_origen(pago.origen_financiero)
    )
    periodos_unicos = tuple(sorted(set(periodos)))
    periodo = None
    if periodos_unicos:
        periodo = periodos_unicos[0] if len(periodos_unicos) == 1 else "Varios"

    # La configuración activa de Factura / Comprobante es la única fuente de
    # los datos institucionales del recibo. Si aún no existe, se conservan los
    # textos por defecto sin inventar información.
    configuracion = get_active_receipt_configuration(db)
    # La nota fiscal predeterminada solo aplica cuando no existe configuración.
    # Una configuración activa con la nota vacía debe respetarse como vacía.
    existe_configuracion = configuracion is not None
    configuracion = configuracion or {}
    proxima_fecha_pago = None
    if pago.origen_financiero == "INTERNET" and periodos_unicos:
        ultimo_periodo = periodos_unicos[-1]
        dia = dias_por_periodo.get(ultimo_periodo)
        if dia is not None:
            proxima_fecha_pago = _fecha_vencimiento_periodo(
                _siguiente_periodo(ultimo_periodo),
                dia,
            )

    return TicketComprobante(
        numero=numero,
        fecha_emision=pago.fecha_hora.date(),
        fecha_hora=pago.fecha_hora,
        id_pago=pago.id_pago,
        id_cliente=pago.id_cliente,
        cliente_nombre=_nombre_completo(
            None if cliente is None else cliente.nombres,
            None if cliente is None else cliente.apellidos,
        )
        or f"Cliente #{pago.id_cliente}",
        cliente_telefono=None if cliente is None else cliente.telefono,
        origen_financiero=pago.origen_financiero,
        servicio=servicio,
        periodo=periodo,
        metodo_pago=None if metodo is None else metodo.nombre,
        responsable=(
            _nombre_completo(empleado.nombres, empleado.apellidos)
            if empleado is not None
            else f"Empleado #{pago.id_empleado}"
        ),
        subtotal=subtotal,
        descuento=CERO,
        total=total,
        saldo_a_favor=saldo_a_favor,
        conceptos=tuple(conceptos),
        archivo_pdf=archivo_pdf,
        empresa_nombre=(configuracion.get("nombre_comercial") or EMPRESA_NOMBRE),
        empresa_descripcion=(
            (configuracion.get("descripcion_empresa") or "").strip()
            or EMPRESA_DESCRIPCION
        ),
        empresa_direccion=configuracion.get("direccion"),
        empresa_telefono=configuracion.get("telefono"),
        # La configuración de comprobantes no administra logotipo.
        empresa_logo_url=None,
        periodos=periodos_unicos,
        proxima_fecha_pago=proxima_fecha_pago,
        agradecimiento=(configuracion.get("mensaje_final") or "").strip()
        or AGRADECIMIENTO,
        nota_fiscal=(
            LEYENDA_FISCAL
            if not existe_configuracion
            else (configuracion.get("nota_fiscal") or "").strip()
        ),
    )


def _direccion_comprobantes() -> Path:
    directorio = (UPLOADS_ROOT / DIRECTORIO_COMPROBANTES).resolve()
    if directorio.parent != UPLOADS_ROOT.resolve():
        raise ComprobantePdfAlmacenamientoError
    return directorio


def _ruta_pdf_existente(comprobante: ComprobanteCobro) -> Path | None:
    """Resuelve solo archivos dentro del directorio asignado a comprobantes."""

    if not comprobante.archivo_pdf:
        return None
    ruta = (BACKEND_ROOT / comprobante.archivo_pdf).resolve()
    directorio = _direccion_comprobantes()
    if ruta.parent != directorio or not ruta.is_file():
        return None
    return ruta


def _siguiente_numero(db: Session) -> str:
    """Genera COB-000001 bajo un lock que serializa toda la numeracion."""

    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:clave))"),
        {"clave": CLAVE_BLOQUEO_NUMERACION},
    )
    numeros = set(db.scalars(select(ComprobanteCobro.numero)).all())
    mayor = 0
    patron = re.compile(r"^COB-(\d{6})$")
    for numero in numeros:
        coincidencia = patron.fullmatch(numero or "")
        if coincidencia is not None:
            mayor = max(mayor, int(coincidencia.group(1)))
    if mayor >= MAXIMO_NUMERO:
        raise ComprobanteNumeracionAgotadaError
    nuevo = f"{PREFIJO_NUMERO}{mayor + 1:06d}"
    if nuevo in numeros:
        raise ComprobanteNumeracionAgotadaError
    return nuevo


def _envolver(texto: str, ancho: float, fuente: str = "Helvetica", tamano: float = 7) -> list[str]:
    return simpleSplit(texto, fuente, tamano, ancho)


def _periodo_en_espanol(periodo: str) -> str:
    """Traduce solo la presentación; conserva las claves YYYY-MM almacenadas."""

    meses = ("enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre")
    return re.sub(
        r"\b(\d{4})-(0[1-9]|1[0-2])\b",
        lambda coincidencia: f"{meses[int(coincidencia[2]) - 1]} de {coincidencia[1]}",
        periodo,
    )


def _alto_ticket(ticket: TicketComprobante) -> float:
    """Calcula la altura variable siguiendo los bloques reales del ticket."""

    ancho_util = ANCHO_PDF - (MARGEN_PDF * 2)

    def cantidad_lineas(texto: str, ancho: float = ancho_util, tamano: float = 7) -> int:
        return max(1, len(_envolver(texto or "—", ancho, tamano=tamano)))

    alto = 10 * mm
    alto += cantidad_lineas(ticket.empresa_nombre, tamano=9) * 10
    for texto in (
        ticket.empresa_descripcion,
        ticket.empresa_direccion or "",
        ticket.empresa_telefono or "",
    ):
        if texto:
            alto += cantidad_lineas(texto, tamano=6) * 7
    alto += 38
    for valor in (ticket.cliente_nombre, ticket.servicio, ticket.metodo_pago or "—"):
        alto += 8 + cantidad_lineas(valor) * 8
    alto += 18
    for concepto in ticket.conceptos:
        etiqueta = _periodo_en_espanol(concepto.periodo or concepto.descripcion)
        alto += cantidad_lineas(etiqueta, ancho_util - 42) * 8 + 3
    if ticket.proxima_fecha_pago is not None:
        alto += 8 + 8
    alto += 20
    alto += (2 + int(ticket.descuento > CERO) + int(ticket.saldo_a_favor > CERO)) * 9
    nota_fiscal = ticket.nota_fiscal.strip()
    # Sin nota fiscal se reduce también el margen inferior del ticket.
    alto += cantidad_lineas(ticket.agradecimiento, tamano=6.5) * 8
    alto += (18 if nota_fiscal else 9)
    if nota_fiscal:
        alto += cantidad_lineas(nota_fiscal, tamano=5) * 6 + 3
    return alto


def _moneda_pdf(valor: Decimal) -> str:
    return f"Q{valor:,.2f}"


def _dibujar_linea(c: canvas.Canvas, y: float, ancho: float) -> None:
    c.setStrokeColor(HexColor("#000000"))
    c.setLineWidth(0.5)
    c.line(MARGEN_PDF, y, ancho - MARGEN_PDF, y)


def _dibujar_campo(
    c: canvas.Canvas,
    etiqueta: str,
    valor: str,
    y: float,
    ancho_util: float,
) -> float:
    """Dibuja una etiqueta y su valor, devolviendo la siguiente coordenada."""

    c.setFillColor(HexColor("#000000"))
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(MARGEN_PDF, y, etiqueta.upper())
    y -= 7
    c.setFillColor(HexColor("#000000"))
    c.setFont("Helvetica", 7)
    for linea in _envolver(valor, ancho_util):
        c.drawString(MARGEN_PDF, y, linea)
        y -= 8
    return y - 1


def _dibujar_pdf(ticket: TicketComprobante, destino: Path | None) -> bytes | None:
    """Genera el ticket de 58 mm y, sin destino, devuelve la copia en memoria."""

    alto = _alto_ticket(ticket)
    ancho_util = ANCHO_PDF - (MARGEN_PDF * 2)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=(ANCHO_PDF, alto))
    y = alto - 5 * mm

    # Encabezado sin logotipo para conservar legibilidad en impresión térmica.
    c.setFillColor(HexColor("#000000"))
    c.setFont("Helvetica-Bold", 9)
    for linea in _envolver(ticket.empresa_nombre, ancho_util, tamano=9):
        c.drawCentredString(ANCHO_PDF / 2, y, linea)
        y -= 10
    c.setFont("Helvetica", 6)
    for linea in _envolver(ticket.empresa_descripcion, ancho_util):
        c.drawCentredString(ANCHO_PDF / 2, y, linea)
        y -= 7
    for datos_empresa in (ticket.empresa_direccion, ticket.empresa_telefono):
        if datos_empresa:
            for linea in _envolver(datos_empresa, ancho_util):
                c.drawCentredString(ANCHO_PDF / 2, y, linea)
                y -= 7
    y -= 4
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(ANCHO_PDF / 2, y, "COMPROBANTE DE PAGO")
    y -= 10
    _dibujar_linea(c, y, ANCHO_PDF)

    y -= 10
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(ANCHO_PDF / 2, y, ticket.numero)
    y -= 9
    c.setFont("Helvetica", 6)
    c.drawCentredString(
        ANCHO_PDF / 2,
        y,
        ticket.fecha_hora.strftime("%d/%m/%Y %H:%M"),
    )
    y -= 12

    y = _dibujar_campo(c, "Cliente", ticket.cliente_nombre, y, ancho_util)
    y = _dibujar_campo(c, "Plan / velocidad", ticket.servicio, y, ancho_util)
    y = _dibujar_campo(c, "Método de pago", ticket.metodo_pago or "—", y, ancho_util)

    _dibujar_linea(c, y, ANCHO_PDF)
    y -= 10
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(MARGEN_PDF, y, "PERÍODO PAGADO")
    c.drawRightString(ANCHO_PDF - MARGEN_PDF, y, "IMPORTE")
    y -= 10
    # Cada detalle conserva el YYYY-MM real del cobro y su importe aplicado.
    for concepto in sorted(ticket.conceptos, key=lambda item: item.periodo or "9999-99"):
        etiqueta = _periodo_en_espanol(concepto.periodo or concepto.descripcion)
        c.setFont("Helvetica", 7)
        lineas = _envolver(etiqueta, ancho_util - 42)
        for linea in lineas:
            c.drawString(MARGEN_PDF, y, linea)
            y -= 8
        c.setFont("Helvetica-Bold", 7)
        c.drawRightString(ANCHO_PDF - MARGEN_PDF, y + 8, _moneda_pdf(concepto.monto))
        y -= 3

    if ticket.proxima_fecha_pago is not None:
        y = _dibujar_campo(
            c,
            "Próxima fecha de pago",
            ticket.proxima_fecha_pago.strftime("%d/%m/%Y"),
            y,
            ancho_util,
        )

    _dibujar_linea(c, y, ANCHO_PDF)
    y -= 10
    totales = [("Subtotal", ticket.subtotal)]
    if ticket.descuento > CERO:
        totales.append(("Descuento", ticket.descuento))
    for etiqueta, valor in totales:
        c.setFont("Helvetica", 6.5)
        c.drawString(MARGEN_PDF, y, etiqueta)
        c.setFont("Helvetica-Bold", 6.5)
        c.drawRightString(ANCHO_PDF - MARGEN_PDF, y, _moneda_pdf(valor))
        y -= 9
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGEN_PDF, y, "TOTAL PAGADO")
    c.drawRightString(ANCHO_PDF - MARGEN_PDF, y, _moneda_pdf(ticket.total))
    y -= 10
    if ticket.saldo_a_favor > CERO:
        c.setFont("Helvetica", 6)
        c.drawString(MARGEN_PDF, y, "Saldo a favor")
        c.setFont("Helvetica-Bold", 6.5)
        c.drawRightString(ANCHO_PDF - MARGEN_PDF, y, _moneda_pdf(ticket.saldo_a_favor))
        y -= 9

    _dibujar_linea(c, y, ANCHO_PDF)
    y -= 10
    c.setFont("Helvetica-Bold", 6.5)
    for linea in _envolver(ticket.agradecimiento, ancho_util, tamano=6.5):
        c.drawCentredString(ANCHO_PDF / 2, y, linea)
        y -= 8
    nota_fiscal = ticket.nota_fiscal.strip()
    if nota_fiscal:
        # Sin nota fiscal no se reserva separación ni línea adicional.
        y -= 3
        c.setFont("Helvetica", 5)
        for linea in _envolver(nota_fiscal, ancho_util, tamano=5):
            c.drawCentredString(ANCHO_PDF / 2, y, linea)
            y -= 6

    c.showPage()
    c.save()
    contenido = buffer.getvalue()
    if not contenido.startswith(b"%PDF"):
        raise ComprobantePdfAlmacenamientoError
    # Sin destino no se escribe en disco: permite descargar una copia actual
    # sin sobrescribir el PDF histórico emitido.
    if destino is None:
        return contenido

    directorio = destino.parent
    try:
        directorio.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ComprobantePdfAlmacenamientoError from error
    temporal = destino.with_name(f".{destino.name}.tmp")
    try:
        temporal.write_bytes(contenido)
        os.replace(temporal, destino)
    except OSError as error:
        temporal.unlink(missing_ok=True)
        raise ComprobantePdfAlmacenamientoError from error
    return None


def _guardar_pdf(ticket: TicketComprobante) -> tuple[str, Path]:
    directorio = _direccion_comprobantes()
    # El sufijo evita colisiones y evita que el nombre sea enumerable por URL.
    destino = directorio / f"{ticket.numero}_{uuid4().hex}.pdf"
    relativa = f"uploads/{DIRECTORIO_COMPROBANTES}/{destino.name}"
    _dibujar_pdf(ticket, destino)
    return relativa, destino


def buscar_comprobante_pago(db: Session, id_pago: int) -> ComprobanteCobro | None:
    """Reutiliza el comprobante ya emitido para un pago idempotente."""

    return db.scalar(
        select(ComprobanteCobro)
        .where(ComprobanteCobro.id_pago == id_pago)
        .order_by(ComprobanteCobro.id_comprobante)
        .limit(1)
    )


def _reutilizar_comprobante(
    db: Session,
    pago: Pago,
    existente: ComprobanteCobro,
) -> tuple[ComprobanteCobro, TicketComprobante, Path | None]:
    """Reutiliza el comprobante emitido y repara su PDF solo si falta."""

    ticket = _construir_ticket(
        db,
        pago,
        numero=existente.numero,
        archivo_pdf=existente.archivo_pdf,
    )
    ruta = _ruta_pdf_existente(existente)
    if ruta is not None:
        return existente, ticket, None
    ruta_relativa, ruta = _guardar_pdf(ticket)
    existente.archivo_pdf = ruta_relativa
    ticket = _construir_ticket(
        db,
        pago,
        numero=existente.numero,
        archivo_pdf=ruta_relativa,
    )
    db.flush()
    return existente, ticket, ruta


def crear_comprobante_pago(
    db: Session,
    pago: Pago,
) -> tuple[ComprobanteCobro, TicketComprobante, Path | None]:
    """Emite una sola vez el comprobante del pago y devuelve su ticket.

    El tercer elemento solo se informa cuando esta llamada creo un archivo
    nuevo, para que el llamador pueda eliminarlo si el COMMIT falla.
    """

    existente = buscar_comprobante_pago(db, pago.id_pago)
    if existente is not None:
        return _reutilizar_comprobante(db, pago, existente)

    # El lock de numeracion tambien serializa la comprobacion final de
    # idempotencia, evitando dos comprobantes para el mismo pago.
    numero = _siguiente_numero(db)
    existente = buscar_comprobante_pago(db, pago.id_pago)
    if existente is not None:
        return _reutilizar_comprobante(db, pago, existente)

    ticket = _construir_ticket(db, pago, numero=numero, archivo_pdf=None)
    ruta_relativa, ruta = _guardar_pdf(ticket)
    try:
        comprobante = ComprobanteCobro(
            id_pago=pago.id_pago,
            numero=numero,
            fecha_emision=pago.fecha_hora.date(),
            archivo_pdf=ruta_relativa,
        )
        db.add(comprobante)
        db.flush()
        ticket = _construir_ticket(
            db,
            pago,
            numero=numero,
            archivo_pdf=ruta_relativa,
        )
    except Exception:
        eliminar_pdf_creado(ruta)
        raise
    return comprobante, ticket, ruta


def eliminar_pdf_creado(ruta: Path | None) -> None:
    """Revierte el archivo si la transaccion financiera no pudo confirmarse."""

    if ruta is None:
        return
    try:
        ruta.unlink(missing_ok=True)
    except OSError:
        pass


def ticket_response(
    comprobante: ComprobanteCobro,
    ticket: TicketComprobante,
) -> dict[str, Any]:
    """Serializa ticket y comprobante en el contrato HTTP de Cobros."""

    return {
        "id_comprobante": comprobante.id_comprobante,
        "id_pago": comprobante.id_pago,
        "numero": comprobante.numero,
        "fecha_emision": comprobante.fecha_emision,
        "fecha_hora": ticket.fecha_hora,
        "archivo_pdf": comprobante.archivo_pdf,
        "id_cliente": ticket.id_cliente,
        "cliente_nombre": ticket.cliente_nombre,
        "cliente_telefono": ticket.cliente_telefono,
        "origen_financiero": ticket.origen_financiero,
        "servicio": ticket.servicio,
        "periodo": ticket.periodo,
        "metodo_pago": ticket.metodo_pago,
        "responsable": ticket.responsable,
        "subtotal": ticket.subtotal,
        "descuento": ticket.descuento,
        "total": ticket.total,
        "saldo_a_favor": ticket.saldo_a_favor,
        "agradecimiento": ticket.agradecimiento,
        "nota_fiscal": ticket.nota_fiscal,
        "empresa_nombre": ticket.empresa_nombre,
        "empresa_descripcion": ticket.empresa_descripcion,
        "empresa_direccion": ticket.empresa_direccion,
        "empresa_telefono": ticket.empresa_telefono,
        "empresa_logo_url": ticket.empresa_logo_url,
        "periodos": list(ticket.periodos),
        "proxima_fecha_pago": ticket.proxima_fecha_pago,
        "conceptos": [
            {
                "descripcion": concepto.descripcion,
                "periodo": concepto.periodo,
                "monto": concepto.monto,
            }
            for concepto in ticket.conceptos
        ],
    }


def consultar_ticket_emitido(
    db: Session,
    comprobante: ComprobanteCobro,
    pago: Pago,
) -> dict[str, Any]:
    """Presenta un comprobante existente sin emitir, reparar su PDF ni confirmar datos."""

    ticket = _construir_ticket(
        db, pago, numero=comprobante.numero, archivo_pdf=comprobante.archivo_pdf,
    )
    return ticket_response(comprobante, ticket)


def ruta_pdf_comprobante(comprobante: ComprobanteCobro) -> Path:
    """Devuelve la ruta fisica segura del PDF persistido."""

    ruta = _ruta_pdf_existente(comprobante)
    if ruta is None:
        raise ComprobantePdfNoDisponibleError
    return ruta


def generar_pdf_termico(
    db: Session,
    comprobante: ComprobanteCobro,
    pago: Pago,
) -> bytes:
    """Genera en memoria la copia térmica actual sin tocar el PDF histórico.

    Reutiliza los datos reales del comprobante y el generador vigente de 58 mm.
    No guarda archivos, no actualiza ``archivo_pdf`` y no crea registros.
    """

    ticket = _construir_ticket(
        db,
        pago,
        numero=comprobante.numero,
        archivo_pdf=comprobante.archivo_pdf,
    )
    contenido = _dibujar_pdf(ticket, None)
    if contenido is None:
        raise ComprobantePdfAlmacenamientoError
    return contenido


def _aplicar_filtro_comprobantes(
    query: Select[Any],
    *,
    id_cobro: int | None,
    id_cliente: int | None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> Select[Any]:
    if id_cliente is not None:
        query = query.where(ComprobanteCobro.id_pago.in_(
            select(Pago.id_pago).where(Pago.id_cliente == id_cliente)
        ))
    if id_cobro is not None:
        query = query.where(ComprobanteCobro.id_pago.in_(
            select(PagoDetalle.id_pago).where(PagoDetalle.id_cobro == id_cobro)
        ))
    if origenes_permitidos is not None:
        query = query.where(
            ComprobanteCobro.id_pago.in_(
                select(Pago.id_pago).where(Pago.origen_financiero.in_(origenes_permitidos))
            )
        )
    return query


def list_comprobantes(
    db: Session,
    *,
    page: int,
    page_size: int,
    id_cobro: int | None = None,
    id_cliente: int | None = None,
    origenes_permitidos: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Pagina comprobantes emitidos y permite recuperarlos desde el historial."""

    filtros = {
        "id_cobro": id_cobro,
        "id_cliente": id_cliente,
        "origenes_permitidos": origenes_permitidos,
    }
    total = int(
        db.scalar(
            _aplicar_filtro_comprobantes(
                select(func.count()).select_from(ComprobanteCobro),
                **filtros,
            )
        )
        or 0
    )
    rows = db.execute(
        _aplicar_filtro_comprobantes(
            select(
                ComprobanteCobro,
                Pago,
                Cliente,
                MetodoPago,
                Empleado,
            )
            .join(Pago, Pago.id_pago == ComprobanteCobro.id_pago)
            .join(Cliente, Cliente.id_cliente == Pago.id_cliente)
            .join(MetodoPago, MetodoPago.id_metodo_pago == Pago.id_metodo_pago)
            .join(Empleado, Empleado.id_empleado == Pago.id_empleado),
            **filtros,
        )
        .order_by(ComprobanteCobro.fecha_emision.desc(), ComprobanteCobro.id_comprobante.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {
                "id_comprobante": row.ComprobanteCobro.id_comprobante,
                "id_pago": row.ComprobanteCobro.id_pago,
                "numero": row.ComprobanteCobro.numero,
                "fecha_emision": row.ComprobanteCobro.fecha_emision,
                "fecha_hora": row.Pago.fecha_hora,
                "archivo_pdf": row.ComprobanteCobro.archivo_pdf,
                "id_cliente": row.Pago.id_cliente,
                "origen_financiero": row.Pago.origen_financiero,
                "cliente_nombre": _nombre_completo(row.Cliente.nombres, row.Cliente.apellidos),
                "metodo_pago": row.MetodoPago.nombre,
                "total": _moneda(row.Pago.monto_total),
                "responsable": _nombre_completo(row.Empleado.nombres, row.Empleado.apellidos),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }
