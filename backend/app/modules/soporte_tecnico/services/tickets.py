"""Consultas y transacciones del soporte sobre las tres tablas existentes."""

from datetime import datetime

from sqlalchemy import String, cast, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.modules.clientes.services.clientes import get_cliente, list_clientes
from app.modules.instalaciones.services.instalaciones import list_tecnicos_activos
from app.modules.soporte_tecnico.models.ticket import CategoriaTicket, Ticket, TicketHistorial
from app.modules.soporte_tecnico.schemas.ticket import SoporteFinalizacion, TicketWrite
from app.services.image_uploads import remove_image_file, store_image


class TicketError(Exception):
    """Error de negocio traducido por el router, sin exponer detalles de PostgreSQL."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def categorias(db: Session):
    """Lista el catálogo activo sin crear ni modificar categorías."""
    return db.scalars(select(CategoriaTicket).where(
        CategoriaTicket.estado == "Activo",
    ).order_by(CategoriaTicket.nombre)).all()


def clientes_disponibles(db: Session):
    """Reutiliza Clientes y proyecta solo los datos necesarios bajo permiso tickets."""
    return [{"id_cliente": c.id_cliente, "nombre": f"{c.nombres} {c.apellidos}".strip(),
             "telefono": c.telefono} for c in list_clientes(db) if c.estado == "Activo"]


def _query():
    """Carga relaciones existentes sin requerir cambios en los módulos propietarios."""
    return select(Ticket).options(joinedload(Ticket.cliente), joinedload(Ticket.categoria),
                                  joinedload(Ticket.tecnico))


def _response(ticket: Ticket) -> dict:
    """Proyección común para tabla y detalle a partir de datos persistidos."""
    return {
        **{field: getattr(ticket, field) for field in (
            "id_ticket", "id_cliente", "id_categoria", "id_tecnico", "canal", "asunto",
            "descripcion", "observaciones", "fecha_apertura", "fecha_inicio", "fecha_resolucion", "estado",
        )},
        "codigo": f"TKT-{ticket.id_ticket:06d}",
        "cliente": f"{ticket.cliente.nombres} {ticket.cliente.apellidos}".strip(),
        "telefono_cliente": ticket.cliente.telefono,
        "categoria": ticket.categoria.nombre,
        "tecnico": None if ticket.tecnico is None else f"{ticket.tecnico.nombres} {ticket.tecnico.apellidos}".strip(),
    }


def listar(db: Session, buscar: str | None = None, estado: str | None = None,
           id_categoria: int | None = None, id_tecnico: int | None = None):
    """Aplica filtros parametrizados; el texto se interpreta literalmente, no como patrón SQL."""
    query = _query().join(Ticket.cliente)
    if buscar and buscar.strip():
        term = buscar.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        from app.modules.clientes.models.cliente import Cliente
        query = query.where(or_(
            Ticket.asunto.ilike(f"%{term}%", escape="\\"),
            (Cliente.nombres + " " + Cliente.apellidos).ilike(f"%{term}%", escape="\\"),
            cast(Ticket.id_ticket, String) == buscar.strip().upper().removeprefix("TKT-").lstrip("0"),
        ))
    for column, value in ((Ticket.estado, estado), (Ticket.id_categoria, id_categoria), (Ticket.id_tecnico, id_tecnico)):
        if value is not None:
            query = query.where(column == value)
    return [_response(ticket) for ticket in db.scalars(query.order_by(
        Ticket.fecha_apertura.desc(), Ticket.id_ticket.desc(),
    )).unique().all()]


def consultar(db: Session, id_ticket: int, id_empleado: int | None = None):
    """Detalle administrativo o limitado al técnico asignado, sin conceder administración."""
    query = _query().where(Ticket.id_ticket == id_ticket)
    if id_empleado is not None:
        query = query.where(Ticket.id_tecnico == id_empleado)
    ticket = db.scalar(query.options(
        selectinload(Ticket.historial).joinedload(TicketHistorial.usuario),
    ).execution_options(populate_existing=True))
    if ticket is None:
        raise TicketError("Ticket no encontrado", 404)
    return {**_response(ticket), "historial": [
        {**{field: getattr(h, field) for field in (
            "id_historial", "id_usuario", "estado_anterior", "estado_nuevo", "accion", "observacion",
            "trabajo_realizado", "resultado_solucion", "evidencia_foto_ruta", "fecha_hora",
        )}, "usuario": f"{h.usuario.nombre} {h.usuario.apellido}".strip()}
        for h in ticket.historial
    ]}


def _validar_relaciones(db: Session, data: TicketWrite):
    """Rechaza cliente/categoría inactivos y asignaciones fuera del catálogo técnico real."""
    client = get_cliente(db, data.id_cliente)
    if client is None or client.estado != "Activo":
        raise TicketError("Selecciona un cliente activo existente")
    category = db.get(CategoriaTicket, data.id_categoria)
    if category is None or category.estado != "Activo":
        raise TicketError("Selecciona una categoría activa existente")
    if not any(t["id_empleado"] == data.id_tecnico for t in list_tecnicos_activos(db)):
        raise TicketError("El técnico debe ser un empleado activo con puesto Técnico activo")


def _ticket_bloqueado(db: Session, id_ticket: int) -> Ticket:
    """Serializa edición, borrado y ejecución sobre la misma fila y su estado vigente."""
    ticket = db.scalar(select(Ticket).where(Ticket.id_ticket == id_ticket)
                       .with_for_update(of=Ticket).execution_options(populate_existing=True))
    if ticket is None:
        raise TicketError("Ticket no encontrado", 404)
    return ticket


def _programada(db: Session, id_ticket: int) -> Ticket:
    """Editar y eliminar quedan bloqueados desde que el técnico confirma el inicio."""
    ticket = _ticket_bloqueado(db, id_ticket)
    if ticket.estado != "Programada":
        raise TicketError("Solo se pueden editar o eliminar tickets en estado Programada", 409)
    return ticket


def validar_tecnico(db: Session, id_empleado: int):
    """Reutiliza Empleados y su puesto real; no basta el rol ni el ID enviado por el cliente."""
    if not any(t["id_empleado"] == id_empleado for t in list_tecnicos_activos(db)):
        raise TicketError("Se requiere un empleado activo con puesto Técnico activo", 403)


def ejecutar(db: Session, id_ticket: int, id_empleado: int, id_usuario: int,
             informe: SoporteFinalizacion | None = None, evidencia: bytes | None = None):
    """Transición atómica del asignado: estado, fechas e historial se confirman juntos.

    La evidencia ya normalizada se almacena con UUID solo después de validar la fila.
    Un reintento no duplica informe/imagen; un fallo revierte datos y retira el archivo nuevo.
    """
    archivo_nuevo = None
    try:
        validar_tecnico(db, id_empleado)
        ticket = _ticket_bloqueado(db, id_ticket)
        if ticket.id_tecnico != id_empleado:
            raise TicketError("El soporte está asignado a otro técnico", 403)
        anterior = "Programada" if informe is None else "En Proceso"
        if ticket.estado != anterior:
            raise TicketError(f"El soporte debe estar {anterior} para esta operación", 409)
        ruta = None
        if informe is not None:
            if not evidencia:
                raise TicketError("La fotografía de evidencia es obligatoria")
            ruta, archivo_nuevo = store_image(evidencia, "soporte_tecnico", "ticket", id_ticket)
            ticket.estado = "Completada"
            ticket.fecha_resolucion = datetime.now()
        else:
            ticket.estado = "En Proceso"
            ticket.fecha_inicio = datetime.now()
        db.add(TicketHistorial(
            id_ticket=id_ticket, id_usuario=id_usuario, estado_anterior=anterior,
            estado_nuevo=ticket.estado, accion="Inicio de soporte" if informe is None else "Finalización de soporte",
            observacion=None if informe is None else (informe.observaciones or "").strip() or None,
            trabajo_realizado=None if informe is None else informe.trabajo_realizado,
            resultado_solucion=None if informe is None else informe.resultado_solucion,
            evidencia_foto_ruta=ruta,
        ))
        db.flush()
        respuesta = consultar(db, id_ticket, id_empleado)
        db.commit()
        return respuesta
    except IntegrityError:
        db.rollback()
        if archivo_nuevo is not None:
            remove_image_file(archivo_nuevo)
        raise TicketError("No fue posible confirmar el soporte por un conflicto de relaciones", 409) from None
    except Exception:
        db.rollback()
        if archivo_nuevo is not None:
            remove_image_file(archivo_nuevo)
        raise


def guardar(db: Session, data: TicketWrite, id_usuario: int, id_ticket: int | None = None):
    """Guarda ticket y auditoría juntos; nunca admite estados ni autores enviados por Angular."""
    try:
        ticket = Ticket(estado="Programada") if id_ticket is None else _programada(db, id_ticket)
        _validar_relaciones(db, data)
        cambios = [campo for campo, valor in data.model_dump().items() if getattr(ticket, campo) != valor]
        for campo, valor in data.model_dump().items():
            setattr(ticket, campo, valor)
        db.add(ticket)
        db.flush()  # PostgreSQL genera la identidad; nunca se calcula con MAX(id) ni conteos.
        db.add(TicketHistorial(
            id_ticket=ticket.id_ticket, id_usuario=id_usuario,
            estado_anterior=None if id_ticket is None else "Programada", estado_nuevo="Programada",
            accion="Creación" if id_ticket is None else "Edición",
            observacion="Ticket registrado" if id_ticket is None else "Campos actualizados: " + (", ".join(cambios) or "Sin cambios"),
        ))
        # La sesión del proyecto usa autoflush=False: explicitar el flush incluye la nueva auditoría.
        db.flush()
        respuesta = consultar(db, ticket.id_ticket)
        db.commit()
        return respuesta
    except IntegrityError:
        db.rollback()
        raise TicketError("No se pudo guardar el ticket por un conflicto de relaciones", 409) from None
    except Exception:
        db.rollback()
        raise


def eliminar(db: Session, id_ticket: int):
    """Eliminación física autorizada: historial y ticket en una transacción, sin CASCADE.

    La FK obligatoria impide conservar una acción de eliminación después del borrado.
    No se tocan archivos de evidencia ni se añade un estado de borrado inexistente.
    """
    try:
        ticket = _programada(db, id_ticket)
        db.execute(delete(TicketHistorial).where(TicketHistorial.id_ticket == id_ticket))
        db.delete(ticket)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise TicketError("El ticket tiene dependencias que impiden eliminarlo", 409) from None
    except Exception:
        db.rollback()
        raise
