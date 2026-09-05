"""Rutas HTTP para consultar y administrar usuarios."""

# ==========================================
# IMPORTS
# ==========================================
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.schemas.usuario import ModuloResponse, UsuarioCreate, UsuarioResponse, UsuarioUpdate
from app.services.auth import Administrator, CurrentUser
from app.services.usuarios import (
    ModulosInvalidosError,
    create_usuario,
    get_usuario,
    list_modulos,
    list_usuarios,
    RolNotFoundError,
    update_usuario,
    UsuarioConflictError,
)


# ==========================================
# ROUTER
# ==========================================
router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])


# ==========================================
# CONSULTAS
# ==========================================
@router.get("/modulos", response_model=list[ModuloResponse])
def get_modulos(current_user: CurrentUser, db=Depends(get_db)) -> list[ModuloResponse]:
    return list_modulos(db)


@router.get("", response_model=list[UsuarioResponse])
def get_usuarios(current_user: CurrentUser, db=Depends(get_db)) -> list[UsuarioResponse]:
    return list_usuarios(db)


@router.get("/{usuario_id}", response_model=UsuarioResponse)
def get_usuario_by_id(
    usuario_id: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> UsuarioResponse:
    usuario = get_usuario(db, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return usuario


# ==========================================
# CREACION Y ACTUALIZACION
# ==========================================
@router.post("", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    data: UsuarioCreate,
    administrator: Administrator,
    db=Depends(get_db),
) -> UsuarioResponse:
    try:
        return create_usuario(db, data)
    except RolNotFoundError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rol no encontrado") from None
    except UsuarioConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El username ya está registrado",
        ) from None
    except ModulosInvalidosError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe seleccionar al menos 2 módulos",
        ) from None


@router.patch("/{usuario_id}", response_model=UsuarioResponse)
def update_user(
    usuario_id: int,
    data: UsuarioUpdate,
    administrator: Administrator,
    db=Depends(get_db),
) -> UsuarioResponse:
    usuario = get_usuario(db, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    try:
        if usuario.id == administrator.id and data.activo is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes eliminar al administrador de la sesión actual",
            )
        return update_usuario(db, usuario, data)
    except RolNotFoundError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rol no encontrado") from None
    except UsuarioConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El username ya está registrado",
        ) from None
    except ModulosInvalidosError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe seleccionar al menos 2 módulos",
        ) from None
