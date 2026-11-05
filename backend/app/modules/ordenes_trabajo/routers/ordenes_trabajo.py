"""Rutas protegidas del módulo de Órdenes de Trabajo.

- CRUD y consultas administrativas: solo Administrador.
- Acciones técnicas (iniciar, evaluación y finalizar): técnico activo asignado.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.modules.auth.services.auth import (
    ActiveSystemEmployee,
    Administrator,
    CurrentUser,
    get_current_employee,
    require_active_system_employee,
)
from app.modules.ordenes_trabajo.schemas.orden_trabajo import (
    EvaluacionOrdenRegistro,
    EvaluacionOrdenResponse,
    EvaluacionOrdenUpdate,
    FinalizacionOrdenRegistro,
    OrdenTrabajoCreate,
    OrdenTrabajoResponse,
    OrdenTrabajoUpdate,
)
from app.modules.ordenes_trabajo.services.ordenes_trabajo import (
    ClienteInactivoError,
    ClienteNotFoundError,
    EmpleadoInactivoError,
    EmpleadoNotFoundError,
    EmpleadoSinPuestoTecnicoError,
    EstadoOrdenError,
    EvaluacionOrdenNotFoundError,
    OrdenTrabajoConflictError,
    OrdenTrabajoNotFoundError,
    RequiereAprobacionComercialError,
    RequiereCotizacionCompletadaError,
    TecnicoNoAsignadoError,
    TipoTrabajoInactivoError,
    TipoTrabajoNotFoundError,
    actualizar_evaluacion,
    continuar_trabajo,
    create_orden,
    delete_orden,
    finalizar_orden,
    get_evaluacion,
    get_orden,
    get_orden_model,
    iniciar_orden,
    list_ordenes,
    list_tecnicos_activos,
    registrar_evaluacion,
    update_orden,
)


router = APIRouter(prefix="/api/ordenes-trabajo", tags=["ordenes-trabajo"])


def _domain_http_error(error: Exception) -> HTTPException:
    if isinstance(error, ClienteNotFoundError):
        return HTTPException(status_code=404, detail="Cliente no encontrado")
    if isinstance(error, ClienteInactivoError):
        return HTTPException(status_code=400, detail="El cliente debe estar activo")
    if isinstance(error, TipoTrabajoNotFoundError):
        return HTTPException(status_code=404, detail="Tipo de trabajo no encontrado")
    if isinstance(error, TipoTrabajoInactivoError):
        return HTTPException(status_code=400, detail="El tipo de trabajo debe estar activo")
    if isinstance(error, EmpleadoNotFoundError):
        return HTTPException(status_code=404, detail="Empleado no encontrado")
    if isinstance(error, EmpleadoInactivoError):
        return HTTPException(status_code=400, detail="El empleado debe estar activo")
    if isinstance(error, EmpleadoSinPuestoTecnicoError):
        return HTTPException(
            status_code=400,
            detail="El empleado debe tener un puesto activo de Técnico",
        )
    if isinstance(error, OrdenTrabajoNotFoundError):
        return HTTPException(status_code=404, detail="Orden de trabajo no encontrada")
    if isinstance(error, EstadoOrdenError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El estado actual de la orden no permite esta operación",
        )
    if isinstance(error, OrdenTrabajoConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La orden tiene dependencias o datos en conflicto",
        )
    raise error


def _tec_http_error(error: Exception) -> HTTPException:
    if isinstance(error, TecnicoNoAsignadoError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La orden está asignada a otro técnico",
        )
    if isinstance(error, OrdenTrabajoNotFoundError):
        return HTTPException(status_code=404, detail="Orden de trabajo no encontrada")
    if isinstance(error, EstadoOrdenError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El estado actual de la orden no permite esta operación",
        )
    if isinstance(error, EvaluacionOrdenNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La orden todavía no tiene evaluación",
        )
    if isinstance(error, RequiereCotizacionCompletadaError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Finalizar la orden requiere cotizacion COMPLETADA por registro en Cobros",
        )
    if isinstance(error, RequiereAprobacionComercialError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La reparación y finalización requieren aprobación comercial real; "
                "se requiere cotización ACEPTADA, COMPLETADA o proforma previa"
            ),
        )
    if isinstance(error, OrdenTrabajoConflictError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La operación entra en conflicto con datos existentes",
        )
    raise error


DOMAIN_ERRORS = (
    ClienteNotFoundError,
    ClienteInactivoError,
    TipoTrabajoNotFoundError,
    TipoTrabajoInactivoError,
    EmpleadoNotFoundError,
    EmpleadoInactivoError,
    EmpleadoSinPuestoTecnicoError,
    OrdenTrabajoNotFoundError,
    EstadoOrdenError,
    OrdenTrabajoConflictError,
)

TEC_ERRORS = (
    TecnicoNoAsignadoError,
    OrdenTrabajoNotFoundError,
    EstadoOrdenError,
    EvaluacionOrdenNotFoundError,
    RequiereAprobacionComercialError,
    OrdenTrabajoConflictError,
)


@router.get("/tecnicos", response_model=list[dict[str, object]])
def get_tecnicos(
    administrator: Administrator,
    db=Depends(get_db),
) -> list[dict[str, object]]:
    """Catálogo de empleados activos con puesto Técnico para el formulario."""

    return list_tecnicos_activos(db)


@router.get("", response_model=list[OrdenTrabajoResponse])
def get_ordenes(
    administrator: Administrator,
    estado: str | None = Query(default=None),
    db=Depends(get_db),
) -> list[OrdenTrabajoResponse]:
    return list_ordenes(db, estado)


@router.get("/{id_orden}", response_model=OrdenTrabajoResponse)
def get_orden_by_id(
    id_orden: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    """Detalle en solo lectura de una orden.

    Reutiliza el endpoint administrativo permitiendo además al técnico asignado
    consultar su propia orden (botón «Ver» de Tareas del Técnico). El Administrador
    conserva el acceso total; un empleado solo procede si su identidad laboral está
    activa y coincide con el técnico asignado en la orden.
    """

    orden = get_orden(db, id_orden)
    if orden is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Orden de trabajo no encontrada",
        )
    # El Administrador mantiene la lectura completa sin validar asignación.
    if current_user.rol.nombre != "Administrador":
        # Empleado inactivo, sin puesto o sin funciones del sistema queda rechazado.
        empleado = require_active_system_employee(get_current_employee(current_user))
        # La orden solo se expone al técnico que figura asignado en id_empleado.
        if orden["id_empleado"] != empleado.id_empleado:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="La orden está asignada a otro técnico",
            )
    return orden


@router.post(
    "",
    response_model=OrdenTrabajoResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_orden_route(
    data: OrdenTrabajoCreate,
    administrator: Administrator,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    try:
        return create_orden(db, data)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.patch("/{id_orden}", response_model=OrdenTrabajoResponse)
def update_orden_route(
    id_orden: int,
    data: OrdenTrabajoUpdate,
    administrator: Administrator,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    orden = get_orden_model(db, id_orden)
    if orden is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Orden de trabajo no encontrada",
        )
    try:
        return update_orden(db, orden, data)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.delete("/{id_orden}", response_model=OrdenTrabajoResponse)
def delete_orden_route(
    id_orden: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    orden = get_orden_model(db, id_orden)
    if orden is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Orden de trabajo no encontrada",
        )
    try:
        return delete_orden(db, orden)
    except DOMAIN_ERRORS as error:
        db.rollback()
        raise _domain_http_error(error) from None


@router.post("/{id_orden}/iniciar", response_model=OrdenTrabajoResponse)
def iniciar_orden_route(
    id_orden: int,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    # El inicio de una orden bloquea inmediatamente su edición y eliminación.
    try:
        return iniciar_orden(db, id_orden, current_employee)
    except TEC_ERRORS as error:
        db.rollback()
        raise _tec_http_error(error) from None


@router.post("/{id_orden}/continuar", response_model=OrdenTrabajoResponse)
def continuar_trabajo_route(
    id_orden: int,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    """Valida en FastAPI que el técnico asignado pueda continuar la reparación
    (ACEPTADA, COMPLETADA o proforma previa); no cambia el estado de la orden."""

    try:
        return continuar_trabajo(db, id_orden, current_employee)
    except TEC_ERRORS as error:
        db.rollback()
        raise _tec_http_error(error) from None


@router.post(
    "/{id_orden}/evaluacion",
    response_model=OrdenTrabajoResponse,
    status_code=status.HTTP_201_CREATED,
)
def registrar_evaluacion_route(
    id_orden: int,
    data: EvaluacionOrdenRegistro,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    """Registra o reemplaza la evaluación de la orden En Proceso."""

    try:
        return registrar_evaluacion(db, id_orden, data, current_employee)
    except TEC_ERRORS as error:
        db.rollback()
        raise _tec_http_error(error) from None


@router.patch("/{id_orden}/evaluacion", response_model=OrdenTrabajoResponse)
def actualizar_evaluacion_route(
    id_orden: int,
    data: EvaluacionOrdenUpdate,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    try:
        return actualizar_evaluacion(db, id_orden, data, current_employee)
    except TEC_ERRORS as error:
        db.rollback()
        raise _tec_http_error(error) from None


@router.get("/{id_orden}/evaluacion", response_model=EvaluacionOrdenResponse)
def get_evaluacion_route(
    id_orden: int,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> EvaluacionOrdenResponse:
    """Expone la evaluacion solo al empleado autenticado asignado a la orden."""

    orden = get_orden_model(db, id_orden)
    if orden is None:
        raise _tec_http_error(OrdenTrabajoNotFoundError())
    # Conserva la misma restriccion de asignacion que iniciar, continuar y finalizar.
    if orden.id_empleado != current_employee.id_empleado:
        raise _tec_http_error(TecnicoNoAsignadoError())
    evaluacion = get_evaluacion(db, id_orden)
    if evaluacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La orden todavía no tiene evaluación",
        )
    return evaluacion


@router.post(
    "/{id_orden}/finalizar",
    response_model=OrdenTrabajoResponse,
)
def finalizar_orden_route(
    id_orden: int,
    data: FinalizacionOrdenRegistro,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> OrdenTrabajoResponse:
    """Confirma la entrega por el tecnico asignado, sin duplicar finalizaciones.

    Exige COMPLETADA por registro en Cobros, incluido pendiente Q0.00; no exige deuda cero.
    """

    try:
        return finalizar_orden(db, id_orden, data, current_employee)
    except TEC_ERRORS as error:
        db.rollback()
        raise _tec_http_error(error) from None
