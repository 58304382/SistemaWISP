"""Rutas HTTP protegidas para catalogos y gestion de clientes."""

# ==========================================
# IMPORTS Y DEPENDENCIAS DE ACCESO
# ==========================================
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.cliente import (
    ClienteCreate,
    ClienteResponse,
    ClienteUpdate,
    DepartamentoResponse,
    MunicipioResponse,
)
from app.services.auth import require_module_access
from app.services.clientes import (
    DepartamentoInactivoError,
    MunicipioInactivoError,
    create_cliente,
    delete_cliente,
    get_cliente,
    list_clientes,
    list_departamentos,
    list_municipios,
    update_cliente,
)


# ==========================================
# ROUTER Y AUTORIZACION DEL MODULO
# ==========================================
router = APIRouter(prefix="/api/clientes", tags=["clientes"])


ClientesUser = Annotated[Usuario, Depends(require_module_access("clientes"))]


def require_clientes_administrator(current_user: ClientesUser) -> Usuario:
    """Exige Administrador para crear, actualizar o dar de baja clientes."""

    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


ClientesAdministrator = Annotated[Usuario, Depends(require_clientes_administrator)]


# ==========================================
# CATALOGOS GEOGRAFICOS
# ==========================================
@router.get("/departamentos", response_model=list[DepartamentoResponse])
def get_departamentos(
    current_user: ClientesUser,
    db=Depends(get_db),
) -> list[DepartamentoResponse]:
    """Lista departamentos activos para formularios de clientes."""

    return list_departamentos(db)


@router.get(
    "/departamentos/{id_departamento}/municipios",
    response_model=list[MunicipioResponse],
)
def get_municipios(
    id_departamento: int,
    current_user: ClientesUser,
    db=Depends(get_db),
) -> list[MunicipioResponse]:
    """Lista municipios activos de un departamento activo."""

    try:
        return list_municipios(db, id_departamento)
    except DepartamentoInactivoError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Departamento no encontrado o inactivo",
        ) from None


# ==========================================
# CONSULTAS DE CLIENTES
# ==========================================
@router.get("", response_model=list[ClienteResponse])
def get_clientes(
    current_user: ClientesUser,
    db=Depends(get_db),
) -> list[ClienteResponse]:
    """Lista clientes, incluidos los que tienen baja logica."""

    return list_clientes(db)


@router.get("/{id_cliente}", response_model=ClienteResponse)
def get_cliente_by_id(
    id_cliente: int,
    current_user: ClientesUser,
    db=Depends(get_db),
) -> ClienteResponse:
    """Obtiene un cliente con municipio e id de departamento."""

    cliente = get_cliente(db, id_cliente)
    if cliente is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return cliente


# ==========================================
# CREACION, ACTUALIZACION Y BAJA LOGICA
# ==========================================
@router.post("", response_model=ClienteResponse, status_code=status.HTTP_201_CREATED)
def create_cliente_route(
    data: ClienteCreate,
    administrator: ClientesAdministrator,
    db=Depends(get_db),
) -> ClienteResponse:
    """Registra un cliente si su ubicacion esta activa."""

    try:
        return create_cliente(db, data)
    except MunicipioInactivoError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El municipio debe estar activo y pertenecer a un departamento activo",
        ) from None


@router.patch("/{id_cliente}", response_model=ClienteResponse)
def update_cliente_route(
    id_cliente: int,
    data: ClienteUpdate,
    administrator: ClientesAdministrator,
    db=Depends(get_db),
) -> ClienteResponse:
    """Actualiza un cliente y mantiene su fecha de modificacion."""

    cliente = get_cliente(db, id_cliente)
    if cliente is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    try:
        return update_cliente(db, cliente, data)
    except MunicipioInactivoError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El municipio debe estar activo y pertenecer a un departamento activo",
        ) from None


@router.delete("/{id_cliente}", response_model=ClienteResponse)
def delete_cliente_route(
    id_cliente: int,
    administrator: ClientesAdministrator,
    db=Depends(get_db),
) -> ClienteResponse:
    """Inactiva el cliente sin eliminarlo fisicamente."""

    cliente = get_cliente(db, id_cliente)
    if cliente is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return delete_cliente(db, cliente)
