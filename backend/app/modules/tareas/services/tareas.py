"""Proyección segura de visitas, instalaciones, órdenes y soportes para el tablero Tareas."""

import unicodedata
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.models.cliente import Cliente
from app.modules.cotizaciones.models.cotizacion import Cotizacion
from app.modules.empleados.models.empleado import Empleado
from app.modules.instalaciones.models.instalacion import Instalacion, InstalacionTecnico
from app.modules.instalaciones.services.instalaciones import materiales_visita
from app.modules.visitas_tecnicas.models.evaluacion_visita import EvaluacionVisita
from app.modules.ordenes_trabajo.models.orden_trabajo import OrdenTrabajo
from app.modules.soporte_tecnico.models.ticket import Ticket
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica
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
    evaluacion = None if visit is None else getattr(visit, "evaluacion", None)
    asignado = any(item.id_empleado == current_employee_id for item in assignments)
    # El tecnico asignado puede operar su instalacion; el administrador conserva acceso.
    puede_operar = (actions_enabled or asignado) and installation.estado in {"Programada", "En Proceso"}
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
            evaluacion.descripcion_trabajo if evaluacion is not None else installation.observaciones
            if installation.observaciones
            else None if visit is None else visit.motivo_visita
        ),
        "materiales": materiales_visita(visit),
        "estado": installation.estado,
        "id_tipo_instalacion": None if visit is None else visit.id_tipo_instalacion,
        "tipo_instalacion": None if visit is None else visit.tipo_instalacion.nombre,
        "tecnicos": [
            _technician(assignment.empleado, lead=assignment.es_encargado)
            for assignment in assignments
        ],
        "ubicacion_disponible": installation.id_ubicacion is not None,
        # La lectura permanece disponible al equipo incluso tras completar; otro equipo no accede.
        "puede_ver": actions_enabled or asignado,
        "puede_realizar_acciones": puede_operar,
        "es_responsable": any(
            assignment.id_empleado == current_employee_id
            for assignment in assignments
        ),
        "bloqueada": not (actions_enabled or asignado),
    }


def _order_task(
    order: OrdenTrabajo,
    *,
    current_employee_id: int,
    actions_enabled: bool,
    reparacion_autorizada: bool,
    trabajo_rechazado: bool,
    tiene_evaluacion: bool,
    tiene_finalizacion: bool,
    id_cotizacion: int | None = None,
    trabajo_adicional_en_revision: bool = False,
    trabajo_adicional_rechazado: bool = False,
    finalizacion_autorizada: bool = False,
) -> dict[str, Any]:
    """Proyecta una orden al DTO unificado.

    El inicio y la evaluación corresponden exclusivamente al técnico asignado.
    Continuar reparacion requiere autorizacion comercial. Confirmar la entrega
    exige COMPLETADA por registro en Cobros, incluso pendiente Q0.00, sin etapa local."""

    is_responsible = order.id_empleado == current_employee_id
    can_perform_actions = is_responsible and order.estado in {
        "Programada",
        "En Proceso",
    }
    return {
        "id": order.id_orden,
        "tipo": "Orden de Trabajo",
        "id_visita": None,
        "id_instalacion": None,
        "id_cliente": order.id_cliente,
        "id_ubicacion": None,
        "numero_propiedad": None,
        "direccion_propiedad": None,
        "referencia_propiedad": None,
        "foto_fachada": None,
        "latitud": None,
        "longitud": None,
        "cliente": (
            f"{order.cliente.nombres} {order.cliente.apellidos}".strip()
        ),
        "fecha": order.fecha_recepcion.date(),
        "hora": order.fecha_recepcion.time(),
        "descripcion": order.titulo,
        "estado": order.estado,
        "id_tipo_instalacion": None,
        "tipo_instalacion": order.tipo_trabajo.nombre,
        "tecnicos": [_technician(order.empleado, lead=True)],
        "ubicacion_disponible": False,
        "puede_ver": True,
        "puede_realizar_acciones": can_perform_actions,
        "es_responsable": is_responsible,
        "bloqueada": not is_responsible,
        "reparacion_autorizada": reparacion_autorizada,
        "trabajo_rechazado": trabajo_rechazado,
        "tiene_evaluacion": tiene_evaluacion,
        "tiene_finalizacion": tiene_finalizacion,
        # La entrega no depende de marcadores locales ni de una finalizacion tecnica previa.
        "puede_finalizar_orden": finalizacion_autorizada and is_responsible and order.estado == "En Proceso",
        "id_cotizacion": id_cotizacion,
        "trabajo_adicional_en_revision": trabajo_adicional_en_revision,
        "trabajo_adicional_rechazado": trabajo_adicional_rechazado,
    }


def _order_commercial_fields(
    order: OrdenTrabajo, cotizaciones: dict[int, Cotizacion],
) -> dict[str, Any]:
    """Deriva el estado comercial de la orden desde su cotización (sin columnas).

    - Autorizada: ACEPTADA, COMPLETADA por registro en Cobros o con Proforma previa.
    - Rechazo total: RECHAZADA sin Proforma (nunca fue aceptada).
    - Trabajo adicional: en revisión (EN PROCESO/GENERADA con Proforma) o
      rechazado (RECHAZADA con Proforma)."""

    evaluacion = order.evaluacion
    cotizacion = (
        None if evaluacion is None else cotizaciones.get(evaluacion.id_evaluacion)
    )
    estado = None if cotizacion is None else cotizacion.estado
    tiene_proforma = cotizacion is not None and cotizacion.proforma is not None
    return {
        # Reparar y entregar son capacidades distintas; entregar exige COMPLETADA.
        "reparacion_autorizada": estado in {"ACEPTADA", "COMPLETADA"} or tiene_proforma,
        "trabajo_rechazado": estado == "RECHAZADA" and not tiene_proforma,
        "tiene_evaluacion": evaluacion is not None,
        "tiene_finalizacion": order.finalizacion is not None,
        # Registrar pendiente/anticipo/total autoriza; solo el tecnico confirma la entrega.
        "finalizacion_autorizada": estado == "COMPLETADA",
        "id_cotizacion": None if cotizacion is None else cotizacion.id_cotizacion,
        "trabajo_adicional_en_revision": tiene_proforma
        and estado in {"EN PROCESO", "GENERADA"},
        "trabajo_adicional_rechazado": tiene_proforma and estado == "RECHAZADA",
    }


def _support_task(ticket: Ticket, *, current_employee_id: int) -> dict[str, Any]:
    """Proyecta la FK real del técnico sin crear tareas ni copiar registros de soporte."""
    asignado = ticket.id_tecnico == current_employee_id
    return {
        "id": ticket.id_ticket, "id_ticket": ticket.id_ticket, "codigo_ticket": f"TKT-{ticket.id_ticket:06d}",
        "tipo": "Soporte Técnico", "id_visita": None, "id_instalacion": None,
        "id_cliente": ticket.id_cliente, "id_ubicacion": None, "numero_propiedad": None,
        "direccion_propiedad": None, "referencia_propiedad": None, "foto_fachada": None,
        "latitud": None, "longitud": None,
        "cliente": f"{ticket.cliente.nombres} {ticket.cliente.apellidos}".strip(),
        "fecha": ticket.fecha_apertura.date(), "hora": ticket.fecha_apertura.time(),
        "descripcion": ticket.asunto, "estado": ticket.estado, "id_tipo_instalacion": None,
        "tipo_instalacion": ticket.categoria.nombre,
        "tecnicos": [] if ticket.tecnico is None else [_technician(ticket.tecnico, lead=True)],
        "ubicacion_disponible": False, "puede_ver": asignado,
        "puede_realizar_acciones": asignado and ticket.estado in {"Programada", "En Proceso"},
        "es_responsable": asignado, "bloqueada": not asignado,
    }


def list_tareas(
    db: Session,
    current_employee: Empleado,
    *,
    actions_enabled: bool = False,
) -> list[dict[str, Any]]:
    """Une las fuentes de trabajo técnico aplicando visibilidad laboral."""

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
        joinedload(Instalacion.visita).joinedload(VisitaTecnica.evaluacion).selectinload(EvaluacionVisita.materiales),
        joinedload(Instalacion.ubicacion),
        selectinload(Instalacion.asignaciones).joinedload(InstalacionTecnico.empleado),
    )
    orders_query = select(OrdenTrabajo).options(
        joinedload(OrdenTrabajo.cliente),
        joinedload(OrdenTrabajo.tipo_trabajo),
        joinedload(OrdenTrabajo.empleado),
        joinedload(OrdenTrabajo.evaluacion),
        joinedload(OrdenTrabajo.finalizacion),
    )

    # Los técnicos comparten visitas, pero conservan el filtro de asignación en
    # instalaciones y órdenes. Las capacidades se calculan por tarea.
    if position == "tecnico":
        installations_query = installations_query.where(
            Instalacion.asignaciones.any(
                InstalacionTecnico.id_empleado == current_employee.id_empleado
            )
        )
        orders_query = orders_query.where(
            OrdenTrabajo.id_empleado == current_employee.id_empleado
        )

    visits = db.scalars(visits_query).unique().all()
    installations = db.scalars(installations_query).unique().all()
    orders = db.scalars(orders_query).unique().all()
    # Estado comercial por evaluación de orden: cotización ACEPTADA, con Proforma
    # previa (trabajo adicional) o RECHAZADA. Sin columnas nuevas, la Proforma
    # conserva la autorización cuando la cotización se reabre para más trabajo.
    evaluaciones_ids = [
        order.evaluacion.id_evaluacion
        for order in orders
        if order.evaluacion is not None
    ]
    cotizaciones_por_evaluacion: dict[int, Cotizacion] = {}
    if evaluaciones_ids:
        cotizaciones_por_evaluacion = {
            cotizacion.id_evaluacion_orden: cotizacion
            for cotizacion in db.scalars(
                select(Cotizacion)
                .options(joinedload(Cotizacion.proforma))
                .where(Cotizacion.id_evaluacion_orden.in_(evaluaciones_ids))
            ).unique().all()
        }
    tasks = [
        _visit_task(visit, current_employee_id=current_employee.id_empleado)
        for visit in visits
    ]
    current_employee_id = current_employee.id_empleado
    tasks.extend(
        _installation_task(
            installation,
            current_employee_id=current_employee_id,
            actions_enabled=actions_enabled,
        )
        for installation in installations
    )
    tasks.extend(
        _order_task(
            order,
            current_employee_id=current_employee_id,
            actions_enabled=actions_enabled,
            **_order_commercial_fields(order, cotizaciones_por_evaluacion),
        )
        for order in orders
    )
    # El soporte nunca amplía la visibilidad administrativa de otros tipos de tareas:
    # solo un Técnico recibe sus tickets asignados, incluidos los ya completados.
    if position == "tecnico":
        tickets = db.scalars(select(Ticket).options(
            joinedload(Ticket.cliente), joinedload(Ticket.categoria), joinedload(Ticket.tecnico),
        ).where(Ticket.id_tecnico == current_employee_id)).unique().all()
        tasks.extend(_support_task(ticket, current_employee_id=current_employee_id) for ticket in tickets)
    tasks.sort(key=lambda task: (task["fecha"], task["hora"], task["tipo"], task["id"]))
    return tasks
