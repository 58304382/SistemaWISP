"""Rutas HTTP para consultar y administrar planes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.plan import PlanCreate, PlanResponse, PlanUpdate, TipoPlan
from app.services.auth import CurrentUser
from app.services.planes import (
    PlanConflictError,
    PlanInUseError,
    create_plan,
    delete_plan,
    get_plan,
    list_planes,
    update_plan,
)


router = APIRouter(prefix="/api/planes", tags=["planes"])


def require_planes_access(current_user: CurrentUser) -> Usuario:
    if not any(modulo.codigo == "planes" and modulo.activo for modulo in current_user.modulos):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para acceder al módulo Planes",
        )
    return current_user


PlanesUser = Annotated[Usuario, Depends(require_planes_access)]


def require_planes_administrator(current_user: PlanesUser) -> Usuario:
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


PlanesAdministrator = Annotated[Usuario, Depends(require_planes_administrator)]


@router.get("", response_model=list[PlanResponse])
def get_planes(
    current_user: PlanesUser,
    tipo_plan: TipoPlan | None = None,
    db=Depends(get_db),
) -> list[PlanResponse]:
    return list_planes(db, tipo_plan)


@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan_by_id(
    plan_id: int,
    current_user: PlanesUser,
    db=Depends(get_db),
) -> PlanResponse:
    plan = get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    return plan


@router.post("", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
def create_plan_route(
    data: PlanCreate,
    administrator: PlanesAdministrator,
    db=Depends(get_db),
) -> PlanResponse:
    try:
        return create_plan(db, data)
    except PlanConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un plan con ese nombre.",
        ) from None


@router.patch("/{plan_id}", response_model=PlanResponse)
def update_plan_route(
    plan_id: int,
    data: PlanUpdate,
    administrator: PlanesAdministrator,
    db=Depends(get_db),
) -> PlanResponse:
    plan = get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    try:
        return update_plan(db, plan, data)
    except PlanConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un plan con ese nombre.",
        ) from None


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_route(
    plan_id: int,
    administrator: PlanesAdministrator,
    db=Depends(get_db),
) -> None:
    plan = get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    try:
        delete_plan(db, plan)
    except PlanInUseError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar este plan porque está siendo utilizado por uno o más servicios.",
        ) from None
