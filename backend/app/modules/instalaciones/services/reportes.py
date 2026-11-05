"""Consulta de solo lectura para reportes administrativos de instalaciones."""

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.reportes import calcular_rango_reporte, describir_periodo
from app.modules.instalaciones.models.instalacion import Instalacion, InstalacionTecnico
from app.modules.instalaciones.schemas.reporte import PeriodoReporteInstalaciones
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica


ESTADOS_INSTALACION = ("Programada", "En Proceso", "Completada")


def _nombre_persona(persona) -> str:
    """Une nombres y apellidos sin introducir valores ficticios."""

    return f"{persona.nombres} {persona.apellidos}".strip()


def _observaciones(instalacion: Instalacion) -> str | None:
    """Conserva por separado el origen de las observaciones disponibles."""

    partes: list[str] = []
    if instalacion.observaciones:
        partes.append(f"General: {instalacion.observaciones.strip()}")
    if instalacion.observaciones_tecnicas:
        partes.append(f"Técnicas: {instalacion.observaciones_tecnicas.strip()}")
    return " | ".join(partes) or None


def generar_reporte_instalaciones(
    db: Session,
    periodo: PeriodoReporteInstalaciones,
    fecha_referencia: date,
    usuario_generador: str,
) -> dict:
    """Consulta instalaciones reales y construye indicadores sin persistir datos."""

    fecha_inicio, fecha_fin = calcular_rango_reporte(periodo, fecha_referencia)
    query = (
        select(Instalacion)
        .options(joinedload(Instalacion.cliente))
        .options(
            joinedload(Instalacion.visita).joinedload(VisitaTecnica.tipo_instalacion)
        )
        .options(
            selectinload(Instalacion.asignaciones).joinedload(
                InstalacionTecnico.empleado
            )
        )
        .where(
            Instalacion.fecha_programada >= fecha_inicio,
            Instalacion.fecha_programada <= fecha_fin,
        )
        .order_by(
            Instalacion.fecha_programada,
            Instalacion.hora_programada,
            Instalacion.id_instalacion,
        )
    )
    instalaciones = list(db.scalars(query).unique().all())
    conteos = {estado: 0 for estado in ESTADOS_INSTALACION}
    filas = []
    for instalacion in instalaciones:
        conteos[instalacion.estado] = conteos.get(instalacion.estado, 0) + 1
        encargado = next(
            (
                asignacion.empleado
                for asignacion in instalacion.asignaciones
                if asignacion.es_encargado
            ),
            None,
        )
        tipo = (
            instalacion.visita.tipo_instalacion.nombre
            if instalacion.visita is not None
            and instalacion.visita.tipo_instalacion is not None
            else None
        )
        filas.append(
            {
                "fecha": instalacion.fecha_programada,
                "cliente": _nombre_persona(instalacion.cliente),
                "tipo_instalacion": tipo,
                "tecnico_responsable": (
                    None if encargado is None else _nombre_persona(encargado)
                ),
                "estado": instalacion.estado,
                "observaciones": _observaciones(instalacion),
            }
        )

    return {
        "titulo": "Reporte de Instalaciones",
        "periodo": periodo,
        "periodo_descripcion": describir_periodo(fecha_inicio, fecha_fin),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "fecha_generacion": datetime.now(timezone.utc),
        "usuario_generador": usuario_generador,
        "total_instalaciones": len(instalaciones),
        "estados": [
            {"estado": estado, "cantidad": conteos[estado]}
            for estado in ESTADOS_INSTALACION
        ],
        "instalaciones": filas,
    }
