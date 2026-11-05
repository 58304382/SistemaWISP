"""Rutas protegidas del catálogo de tipos de trabajo (solo administrador)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.modules.auth.services.auth import Administrator
from app.modules.ordenes_trabajo.schemas.tipo_trabajo import (
    TipoTrabajoCreate,
    TipoTrabajoResponse,
    TipoTrabajoUpdate,
)
from app.modules.ordenes_trabajo.services.tipos_trabajo import (
    TipoTrabajoDuplicateError,
    TipoTrabajoEnUsoError,
    TipoTrabajoNotFoundError,
    create_tipo_trabajo,
    delete_tipo_trabajo,
    get_tipo_trabajo,
    list_tipos_trabajo,
    update_tipo_trabajo,
)


router = APIRouter(prefix="/api/tipos-trabajo", tags=["tipos-trabajo"])


@router.get("", response_model=list[TipoTrabajoResponse])
def get_tipos_trabajo(
    administrator: Administrator,
    activos: bool = Query(default=False),
    db=Depends(get_db),
) -> list[TipoTrabajoResponse]:
    """Lista el catálogo; el parámetro activos=true alimenta los formularios."""

    return list_tipos_trabajo(db, solo_activos=activos)


@router.post(
    "",
    response_model=TipoTrabajoResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_tipo_trabajo(
    data: TipoTrabajoCreate,
    administrator: Administrator,
    db=Depends(get_db),
) -> TipoTrabajoResponse:
    try:
        return create_tipo_trabajo(db, data)
    except TipoTrabajoDuplicateError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El nombre del tipo de trabajo ya está registrado",
        ) from None


@router.patch("/{id_tipo_trabajo}", response_model=TipoTrabajoResponse)
def patch_tipo_trabajo(
    id_tipo_trabajo: int,
    data: TipoTrabajoUpdate,
    administrator: Administrator,
    db=Depends(get_db),
) -> TipoTrabajoResponse:
    tipo = get_tipo_trabajo(db, id_tipo_trabajo)
    if tipo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de trabajo no encontrado",
        )
    try:
        return update_tipo_trabajo(db, tipo, data)
    except TipoTrabajoEnUsoError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except TipoTrabajoDuplicateError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El nombre del tipo de trabajo ya está registrado",
        ) from None


@router.delete("/{id_tipo_trabajo}", response_model=TipoTrabajoResponse)
def delete_tipo(
    id_tipo_trabajo: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> TipoTrabajoResponse:
    tipo = get_tipo_trabajo(db, id_tipo_trabajo)
    if tipo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tipo de trabajo no encontrado",
        )
    try:
        return delete_tipo_trabajo(db, tipo)
    except TipoTrabajoEnUsoError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
