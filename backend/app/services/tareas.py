"""Proyección segura de visitas e instalaciones para el tablero Tareas."""

import unicodedata
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.cliente import Cliente
from app.models.empleado import Empleado
from app.models.instalacion import Instalacion, InstalacionTecnico
from app.models.visita_tecnica import VisitaTecnica
from app.services.image_uploads import image_url


def _normalize_position(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(
        character for character in normalized if unicodedata.category(character) != "Mn"
    ).casefold().strip()


def _technician(employee: Empleado, *, lead: bool) -> dict[str, Any]:
    return {
        "id_empleado": employee.id_empleado,
        "codigo": employee.codigo,
        "nombre": f"{employee.nombres} {employee.apellidos}".strip(),
        "es_encargado": lead,
    }


def _visit_task(visit: VisitaTecnica, *, current_employee_id: int) -> dict[str, Any]:
    is_responsible = visit.id_empleado == current_employee_id
    can_perform_actions = is_responsible and visit.estado in {
        "Programada",
        "En Proceso",
    }
    return {
        "id": visit.id_visita,
        "tipo": "Visita Técnica",
        "id_visita": visit.id_visita,
        "id_instalacion": None,
        "id_cliente": visit.id_cliente,
        "id_ubicacion": visit.id_ubicacion,
        "numero_propiedad": (
            None if visit.ubicacion is None else visit.ubicacion.numero_propiedad
        ),
        "direccion_propiedad": (
            None if visit.ubicacion is None else visit.ubicacion.direccion
        ),
        "referencia_propiedad": (
            None if visit.ubicacion is None else visit.ubicacion.referencia
        ),
        "foto_fachada": (
            None if visit.ubicacion is None else image_url(visit.ubicacion.foto_fachada)
        ),
        "latitud": None if visit.ubicacion is None else visit.ubicacion.latitud,
        "longitud": None if visit.ubicacion is None else visit.ubicacion.longitud,
        "cliente": f"{visit.cliente.nombres} {visit.cliente.apellidos}".strip(),
        "fecha": visit.fecha_programada,
        "hora": visit.hora_programada,
        "descripcion": visit.motivo_visita,
        "estado": visit.estado,
        "id_tipo_instalacion": visit.id_tipo_instalacion,
        "tipo_instalacion": visit.tipo_instalacion.nombre,
        "tecnicos": [_technician(visit.empleado, lead=True)],
        "ubicacion_disponible": visit.id_ubicacion is not None,
        "puede_ver": True,
        "puede_realizar_acciones": can_perform_actions,
        "es_responsable": is_responsible,
        "bloqueada": not is_responsible,
    }


def _installation_task(
    installation: Instalacion,
    *,
    current_employee_id: int,
    actions_enabled: bool,
) -> dict[str, Any]:
    assignments = sorted(
        installation.asignaciones,
        key=lambda item: (
            not item.es_encargado,
            item.empleado.apellidos,
            item.empleado.nombres,
            item.id_empleado,
        ),
    )
    visit = installation.visita
    location = installation.ubicacion
    return {
        "id": installation.id_instalacion,
        "tipo": "Instalación",
        "id_visita": installation.id_visita,
        "id_instalacion": installation.id_instalacion,
        "id_cliente": installation.id_cliente,
        # La propiedad de la instalación es su FK directa; la visita no sustituye esa fuente.
        "id_ubicacion": installation.id_ubicacion,
        "numero_propiedad": (
            None if location is None else location.numero_propiedad
        ),
        "direccion_propiedad": None if location is None else location.direccion,
        "referencia_propiedad": None if location is None else location.referencia,
        "foto_fachada": (
            None if location is None else image_url(location.foto_fachada)
        ),
        "latitud": None if location is None else location.latitud,
        "longitud": None if location is None else location.longitud,
        "cliente": (
            f"{installation.cliente.nombres} {installation.cliente.apellidos}".strip()
        ),
        "fecha": installation.fecha_programada,
        "hora": installation.hora_programada,
        "descripcion": (
            installation.observaciones
            if installation.observaciones
            else None if visit is None else visit.motivo_visita
        ),
        "estado": installation.estado,
        "id_tipo_instalacion": None if visit is None else visit.id_tipo_instalacion,
        "tipo_instalacion": None if visit is None else visit.tipo_instalacion.nombre,
        "tecnicos": [
            _technician(assignment.empleado, lead=assignment.es_encargado)
            for assignment in assignments
        ],
        "ubicacion_disponible": installation.id_ubicacion is not None,
        "puede_ver": True,
        "puede_realizar_acciones": actions_enabled,
        "es_responsable": any(
            assignment.id_empleado == current_employee_id
            for assignment in assignments
        ),
        "bloqueada": not actions_enabled,
    }


def list_tareas(
    db: Session,
    current_employee: Empleado,
    *,
    actions_enabled: bool = False,
) -> list[dict[str, Any]]:
    """Une ambas fuentes aplicando visibilidad laboral antes de cargar resultados."""

    position = _normalize_position(current_employee.puesto.nombre)
    if position not in {"tecnico", "gerente administrativo"}:
        return []

    visits_query = select(VisitaTecnica).options(
        joinedload(VisitaTecnica.cliente),
        joinedload(VisitaTecnica.ubicacion),
        joinedload(VisitaTecnica.empleado),
        joinedload(VisitaTecnica.tipo_instalacion),
    )
    installations_query = select(Instalacion).options(
        joinedload(Instalacion.cliente).joinedload(Cliente.municipio),
        joinedload(Instalacion.visita).joinedload(VisitaTecnica.tipo_instalacion),
        joinedload(Instalacion.ubicacion),
        selectinload(Instalacion.asignaciones).joinedload(InstalacionTecnico.empleado),
    )

    # Los técnicos comparten visibilidad de visitas, pero las instalaciones
    # conservan su filtro de asignación. Las capacidades se calculan por tarea.
    if position == "tecnico":
        installations_query = installations_query.where(
            Instalacion.asignaciones.any(
                InstalacionTecnico.id_empleado == current_employee.id_empleado
            )
        )

    visits = db.scalars(visits_query).unique().all()
    installations = db.scalars(installations_query).unique().all()
    tasks = [
        _visit_task(visit, current_employee_id=current_employee.id_empleado)
        for visit in visits
    ]
    tasks.extend(
        _installation_task(
            installation,
            current_employee_id=current_employee.id_empleado,
            actions_enabled=actions_enabled,
        )
        for installation in installations
    )
    tasks.sort(key=lambda task: (task["fecha"], task["hora"], task["tipo"], task["id"]))
    return tasks
