"""Consulta de solo lectura para el reporte administrativo de Soporte Técnico."""

from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.reportes import calcular_rango_reporte, describir_periodo
from app.modules.soporte_tecnico.models.ticket import Ticket
from app.modules.soporte_tecnico.schemas.reporte import PeriodoReporte


ESTADOS_TICKET = ("Programada", "En Proceso", "Completada")


def _nombre_persona(persona) -> str:
    """Une nombres y apellidos sin introducir valores ficticios."""

    return f"{persona.nombres} {persona.apellidos}".strip()


def _resultado(ticket: Ticket) -> str | None:
    """Recupera el último resultado real guardado en el historial del ticket."""

    for historial in reversed(ticket.historial):
        resultado = (historial.resultado_solucion or "").strip()
        if resultado:
            return resultado
    return None


def generar_reporte_soporte(
    db: Session,
    periodo: PeriodoReporte,
    fecha_referencia: date,
    usuario_generador: str,
) -> dict:
    """Consulta tickets reales por fecha de apertura y sus estados persistidos."""

    fecha_inicio, fecha_fin = calcular_rango_reporte(periodo, fecha_referencia)
    inicio = datetime.combine(fecha_inicio, time.min)
    fin = datetime.combine(fecha_fin, time.max)
    query = (
        select(Ticket)
        .options(
            joinedload(Ticket.cliente),
            joinedload(Ticket.categoria),
            joinedload(Ticket.tecnico),
            selectinload(Ticket.historial),
        )
        .where(Ticket.fecha_apertura >= inicio, Ticket.fecha_apertura <= fin)
        .order_by(Ticket.fecha_apertura, Ticket.id_ticket)
    )
    tickets = list(db.scalars(query).unique().all())

    conteos = {estado: 0 for estado in ESTADOS_TICKET}
    filas = []
    for ticket in tickets:
        conteos[ticket.estado] = conteos.get(ticket.estado, 0) + 1
        filas.append(
            {
                "fecha": ticket.fecha_apertura.date(),
                "cliente": _nombre_persona(ticket.cliente),
                "categoria": None
                if ticket.categoria is None
                else ticket.categoria.nombre,
                "tecnico": None
                if ticket.tecnico is None
                else _nombre_persona(ticket.tecnico),
                "estado": ticket.estado,
                "resultado": _resultado(ticket),
            }
        )

    return {
        "tipo": "soporte",
        "titulo": "Reporte de Soporte Técnico",
        "periodo": periodo,
        "periodo_descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "fecha_generacion": datetime.now(timezone.utc),
        "usuario_generador": usuario_generador,
        "total_tickets": len(tickets),
        "programados": conteos["Programada"],
        "en_proceso": conteos["En Proceso"],
        "completados": conteos["Completada"],
        "tickets": filas,
    }
