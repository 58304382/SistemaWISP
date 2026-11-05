"""Administración con permiso tickets y ejecución restringida al técnico asignado desde Tareas."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, Response, UploadFile

from app.modules.auth.services.auth import (
    Administrator, CurrentUser, DbSession, get_current_employee, require_active_system_employee, require_module_access,
)
from app.modules.empleados.models.empleado import Empleado
from app.modules.soporte_tecnico.schemas.reporte import (
    PeriodoReporte,
    ReporteSoporteResponse,
)
from app.modules.soporte_tecnico.schemas.ticket import (
    CategoriaResponse, ClienteOption, EstadoTicket, SoporteFinalizacion, TecnicoOption,
    TextoObligatorio, TicketDetalle, TicketResponse, TicketWrite,
)
from app.modules.soporte_tecnico.services import tickets as service
from app.modules.soporte_tecnico.services.reportes import generar_reporte_soporte
from app.modules.soporte_tecnico.schemas.categoria import CategoriaTicketWrite, CategoriaTicketUpdate
from app.modules.soporte_tecnico.services import categorias as catalogo
from app.modules.usuarios.models.usuario import Usuario
from app.services.image_uploads import (
    ImagePathError, ImageStorageError, ImageTooLargeError, InvalidImageError, read_image,
)

router = APIRouter(prefix="/api/tickets", tags=["soporte-tecnico"])
TicketsUser = Annotated[Usuario, Depends(require_module_access("tickets"))]
TicketId = Annotated[int, Path(gt=0)]


# Administración separada del GET activo consumido por el formulario de tickets.
@router.get("/categorias/todas", response_model=list[CategoriaResponse])
def listar_catalogo_categorias(db: DbSession, user: Administrator):
    return catalogo.listar_categorias(db)


@router.post("/categorias", response_model=CategoriaResponse, status_code=201)
def crear_categoria(data: CategoriaTicketWrite, db: DbSession, user: Administrator):
    try:
        return catalogo.guardar_categoria(db, data)
    except catalogo.CategoriaError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None


@router.patch("/categorias/{id_categoria}", response_model=CategoriaResponse)
def editar_categoria(id_categoria: Annotated[int, Path(gt=0)], data: CategoriaTicketUpdate, db: DbSession, user: Administrator):
    try:
        return catalogo.guardar_categoria(db, data, id_categoria)
    except catalogo.CategoriaError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None


def _operacion(function, *args):
    """Traduce solo errores de negocio conocidos y conserva la validación HTTP de FastAPI."""
    try:
        return function(*args)
    except service.TicketError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None
    except ImageTooLargeError:
        raise HTTPException(status_code=413, detail="La fotografía excede 5 MB") from None
    except InvalidImageError:
        raise HTTPException(status_code=400, detail="La fotografía debe ser una imagen JPG, PNG o WEBP válida") from None
    except (ImagePathError, ImageStorageError):
        raise HTTPException(status_code=409, detail="No fue posible almacenar la fotografía de evidencia") from None


def require_ticket_operator(db: DbSession, user: CurrentUser) -> Empleado:
    """Tareas conserva clientes; la ejecución exige identidad laboral técnica activa, sin bypass por rol."""
    require_module_access("clientes")(user)
    employee = require_active_system_employee(get_current_employee(user))
    _operacion(service.validar_tecnico, db, employee.id_empleado)
    return employee


TicketOperator = Annotated[Empleado, Depends(require_ticket_operator)]


def ticket_read_scope(db: DbSession, user: CurrentUser) -> int | None:
    """Reutiliza el detalle: administración autorizada o solo el ticket asignado desde Tareas."""
    if any(modulo.codigo == "tickets" and modulo.activo for modulo in user.modulos):
        return None
    return require_ticket_operator(db, user).id_empleado


TicketReadScope = Annotated[int | None, Depends(ticket_read_scope)]


@router.get("/categorias", response_model=list[CategoriaResponse])
def get_categorias(db: DbSession, user: TicketsUser):
    """Consulta el catálogo real de categorías activas."""
    return service.categorias(db)


@router.get("/clientes", response_model=list[ClienteOption])
def get_clientes(db: DbSession, user: TicketsUser):
    """Selector mínimo para soporte sin conceder acceso al módulo completo de Clientes."""
    return service.clientes_disponibles(db)


@router.get("/tecnicos", response_model=list[TecnicoOption])
def get_tecnicos(db: DbSession, user: TicketsUser):
    """Reutiliza el filtro real de empleados activos con puesto Técnico activo."""
    return service.list_tecnicos_activos(db)


@router.get("/reporte", response_model=ReporteSoporteResponse)
def get_reporte_soporte(
    db: DbSession,
    administrator: Administrator,
    periodo: PeriodoReporte = Query(...),
    fecha: date = Query(...),
) -> ReporteSoporteResponse:
    """Genera la vista administrativa de tickets sin modificar sus datos."""

    nombre = f"{administrator.nombre} {administrator.apellido}".strip()
    usuario = f"{nombre} ({administrator.username})"
    return generar_reporte_soporte(db, periodo, fecha, usuario)


@router.get("", response_model=list[TicketResponse])
def get_tickets(db: DbSession, user: TicketsUser,
                buscar: str | None = Query(default=None, max_length=200),
                estado: EstadoTicket | None = None,
                id_categoria: int | None = Query(default=None, gt=0),
                id_tecnico: int | None = Query(default=None, gt=0)):
    """Listado con filtros validados y consultas parametrizadas."""
    return service.listar(db, buscar, estado, id_categoria, id_tecnico)


@router.get("/{id_ticket}", response_model=TicketDetalle)
def get_ticket(id_ticket: TicketId, db: DbSession, scope: TicketReadScope):
    """Comparte informe e historial sin permitir al técnico consultar tickets ajenos."""
    return _operacion(service.consultar, db, id_ticket, scope)


@router.post("/{id_ticket}/iniciar", response_model=TicketDetalle)
def iniciar_ticket(id_ticket: TicketId, db: DbSession, user: CurrentUser, employee: TicketOperator):
    """Inicia solo el asignado autenticado y bloquea inmediatamente la administración del ticket."""
    return _operacion(service.ejecutar, db, id_ticket, employee.id_empleado, user.id)


@router.post("/{id_ticket}/finalizar", response_model=TicketDetalle)
async def finalizar_ticket(
    id_ticket: TicketId, db: DbSession, user: CurrentUser, employee: TicketOperator,
    trabajo_realizado: Annotated[TextoObligatorio, Form()],
    resultado_solucion: Annotated[TextoObligatorio, Form()],
    evidencia: Annotated[UploadFile, File()],
    observaciones: Annotated[str | None, Form()] = None,
):
    """Exige informe e imagen real; nunca confía en extensión, MIME, estado o autor del navegador."""
    try:
        contenido = await read_image(evidencia)
    except ImageTooLargeError:
        raise HTTPException(status_code=413, detail="La fotografía excede 5 MB") from None
    except InvalidImageError:
        raise HTTPException(status_code=400, detail="La fotografía debe ser una imagen JPG, PNG o WEBP válida") from None
    finally:
        await evidencia.close()
    informe = SoporteFinalizacion(trabajo_realizado=trabajo_realizado,
                                 resultado_solucion=resultado_solucion, observaciones=observaciones)
    return _operacion(service.ejecutar, db, id_ticket, employee.id_empleado, user.id, informe, contenido)


@router.post("", response_model=TicketDetalle, status_code=201)
def post_ticket(data: TicketWrite, db: DbSession, user: TicketsUser):
    """Registra Programada y utiliza el autor de la sesión JWT."""
    return _operacion(service.guardar, db, data, user.id)


@router.put("/{id_ticket}", response_model=TicketDetalle)
def put_ticket(id_ticket: TicketId, data: TicketWrite, db: DbSession, user: TicketsUser):
    """La edición se valida bajo bloqueo en el servicio, no solo desde la interfaz."""
    return _operacion(service.guardar, db, data, user.id, id_ticket)


@router.delete("/{id_ticket}", status_code=204)
def delete_ticket(id_ticket: TicketId, db: DbSession, user: TicketsUser):
    """Elimina Programada e historial de forma atómica según la política autorizada."""
    _operacion(service.eliminar, db, id_ticket)
    return Response(status_code=204)
