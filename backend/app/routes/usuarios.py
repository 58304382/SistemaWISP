"""Rutas HTTP para consultar y administrar usuarios."""

# ==========================================
# IMPORTS
# ==========================================
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.schemas.usuario import (
    EmpleadoDisponibleResponse,
    ModuloResponse,
    UsuarioAdminResponse,
    UsuarioCreate,
    UsuarioUpdate,
)
from app.services.auth import Administrator
from app.services.usuarios import (
    EmpleadoAlreadyLinkedError,
    EmpleadoInactivoError,
    EmpleadoNotFoundError,
    ModulosInvalidosError,
    PuestoInactivoError,
    PuestoSinFuncionesError,
    create_usuario,
    get_usuario,
    list_empleados_disponibles,
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
def get_modulos(administrator: Administrator, db=Depends(get_db)) -> list[ModuloResponse]:
    return list_modulos(db)


@router.get("/empleados-disponibles", response_model=list[EmpleadoDisponibleResponse])
def get_empleados_disponibles(
    administrator: Administrator,
    db=Depends(get_db),
) -> list[EmpleadoDisponibleResponse]:
    """Expone el catálogo mínimo y autoritativo para crear cuentas vinculadas."""

    return list_empleados_disponibles(db)


@router.get("", response_model=list[UsuarioAdminResponse])
def get_usuarios(administrator: Administrator, db=Depends(get_db)) -> list[UsuarioAdminResponse]:
    return list_usuarios(db)


@router.get("/{usuario_id}", response_model=UsuarioAdminResponse)
def get_usuario_by_id(
    usuario_id: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> UsuarioAdminResponse:
    usuario = get_usuario(db, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")
    return usuario


# ==========================================
# CREACION Y ACTUALIZACION
# ==========================================
@router.post("", response_model=UsuarioAdminResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    data: UsuarioCreate,
    administrator: Administrator,
    db=Depends(get_db),
) -> UsuarioAdminResponse:
    try:
        return create_usuario(db, data)
    except RolNotFoundError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rol no encontrado") from None
    except UsuarioConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El username ya está registrado",
        ) from None
    except EmpleadoNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empleado no encontrado",
        ) from None
    except EmpleadoInactivoError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El empleado debe estar activo",
        ) from None
    except PuestoInactivoError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El puesto del empleado debe estar activo",
        ) from None
    except PuestoSinFuncionesError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El puesto del empleado no tiene funciones en SistemaWISP",
        ) from None
    except EmpleadoAlreadyLinkedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El empleado ya tiene una cuenta de usuario asociada",
        ) from None
    except ModulosInvalidosError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debe seleccionar al menos 2 módulos",
        ) from None


@router.patch("/{usuario_id}", response_model=UsuarioAdminResponse)
def update_user(
    usuario_id: int,
    data: UsuarioUpdate,
    administrator: Administrator,
    db=Depends(get_db),
) -> UsuarioAdminResponse:
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
