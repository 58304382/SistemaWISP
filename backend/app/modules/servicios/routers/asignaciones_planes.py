"""Endpoints del submódulo Servicios - Asignación de Planes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.modules.auth.services.auth import require_module_access
from app.modules.servicios.schemas.asignacion_plan import (
    AsignacionPlanCreate,
    AsignacionPlanResponse,
    AsignacionPlanUpdate,
    ClienteAsignacionCatalogoResponse,
    EstadoAsignacion,
    PlanAsignacionCatalogoResponse,
)
from app.modules.servicios.services.asignaciones_planes import (
    AsignacionActivaDuplicadaError,
    AsignacionConRegistrosRelacionadosError,
    AsignacionInvalidaError,
    ClienteAsignacionNoEncontradoError,
    PlanAsignacionNoDisponibleError,
    create_asignacion,
    delete_asignacion,
    get_asignacion,
    list_asignaciones,
    list_clientes_catalogo,
    list_planes_activos_catalogo,
    update_asignacion,
)
from app.modules.usuarios.models.usuario import Usuario


router = APIRouter(prefix="/api/servicios/asignaciones-planes", tags=["servicios"])
ServiciosUser = Annotated[Usuario, Depends(require_module_access("servicios"))]


def _raise_business_error(error: Exception) -> None:
    """Traduce reglas de negocio a respuestas HTTP estables para Angular."""

    if isinstance(error, ClienteAsignacionNoEncontradoError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente no encontrado",
        ) from None
    if isinstance(error, PlanAsignacionNoDisponibleError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El plan seleccionado no existe o está inactivo",
        ) from None
    if isinstance(error, AsignacionActivaDuplicadaError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El cliente ya tiene una asignación activa de Internet",
        ) from None
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Los datos de la asignación no son válidos",
    ) from None


@router.get("/catalogos/clientes", response_model=list[ClienteAsignacionCatalogoResponse])
def get_clientes_catalogo(
    current_user: ServiciosUser, db=Depends(get_db)
) -> list[ClienteAsignacionCatalogoResponse]:
    return list_clientes_catalogo(db)


@router.get("/catalogos/planes", response_model=list[PlanAsignacionCatalogoResponse])
def get_planes_catalogo(
    current_user: ServiciosUser, db=Depends(get_db)
) -> list[PlanAsignacionCatalogoResponse]:
    return list_planes_activos_catalogo(db)


@router.get("", response_model=list[AsignacionPlanResponse])
def get_asignaciones(
    current_user: ServiciosUser,
    estado: EstadoAsignacion | None = None,
    db=Depends(get_db),
) -> list[AsignacionPlanResponse]:
    return list_asignaciones(db, estado)


@router.get("/{asignacion_id}", response_model=AsignacionPlanResponse)
def get_asignacion_by_id(
    asignacion_id: int,
    current_user: ServiciosUser,
    db=Depends(get_db),
) -> AsignacionPlanResponse:
    asignacion = get_asignacion(db, asignacion_id)
    if asignacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asignación no encontrada",
        )
    return asignacion


@router.post("", response_model=AsignacionPlanResponse, status_code=status.HTTP_201_CREATED)
def create_asignacion_route(
    data: AsignacionPlanCreate,
    current_user: ServiciosUser,
    db=Depends(get_db),
) -> AsignacionPlanResponse:
    try:
        return create_asignacion(db, data)
    except (
        ClienteAsignacionNoEncontradoError,
        PlanAsignacionNoDisponibleError,
        AsignacionActivaDuplicadaError,
        AsignacionInvalidaError,
    ) as error:
        _raise_business_error(error)


@router.patch("/{asignacion_id}", response_model=AsignacionPlanResponse)
def update_asignacion_route(
    asignacion_id: int,
    data: AsignacionPlanUpdate,
    current_user: ServiciosUser,
    db=Depends(get_db),
) -> AsignacionPlanResponse:
    asignacion = get_asignacion(db, asignacion_id)
    if asignacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asignación no encontrada",
        )
    try:
        return update_asignacion(db, asignacion, data)
    except (
        ClienteAsignacionNoEncontradoError,
        PlanAsignacionNoDisponibleError,
        AsignacionActivaDuplicadaError,
        AsignacionInvalidaError,
    ) as error:
        _raise_business_error(error)


@router.delete("/{asignacion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asignacion_route(
    asignacion_id: int,
    current_user: ServiciosUser,
    db=Depends(get_db),
) -> None:
    """Elimina únicamente asignaciones sin historial ni relaciones protegidas."""

    asignacion = get_asignacion(db, asignacion_id)
    if asignacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asignación no encontrada",
        )
    try:
        delete_asignacion(db, asignacion)
    except AsignacionConRegistrosRelacionadosError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La asignación tiene historial financiero o registros relacionados "
                "y no puede eliminarse. Puede cambiar su estado a «Cancelado»."
            ),
        ) from None
