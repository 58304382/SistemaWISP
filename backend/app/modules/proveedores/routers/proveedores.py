"""Rutas protegidas para catálogos y gestión de proveedores."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.modules.auth.services.auth import require_module_access
from app.modules.clientes.schemas.cliente import DepartamentoResponse, MunicipioResponse
from app.modules.clientes.services.clientes import (
    DepartamentoInactivoError,
    list_departamentos,
    list_municipios,
)
from app.modules.proveedores.schemas.proveedor import (
    ProveedorCreate,
    ProveedorEstadoUpdate,
    ProveedorResponse,
    ProveedorUpdate,
)
from app.modules.proveedores.services.proveedores import (
    MunicipioProveedorError,
    ProveedorConflictError,
    ProveedorEnUsoError,
    create_proveedor,
    delete_proveedor,
    get_proveedor,
    list_proveedores,
    set_proveedor_estado,
    update_proveedor,
)
from app.modules.usuarios.models.usuario import Usuario


router = APIRouter(prefix="/api/proveedores", tags=["proveedores"])
ProveedoresUser = Annotated[Usuario, Depends(require_module_access("proveedores"))]


def require_proveedores_administrator(current_user: ProveedoresUser) -> Usuario:
    """Restringe las operaciones que modifican proveedores a administradores."""

    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


ProveedoresAdministrator = Annotated[
    Usuario, Depends(require_proveedores_administrator)
]


@router.get("/departamentos", response_model=list[DepartamentoResponse])
def get_departamentos(
    current_user: ProveedoresUser, db=Depends(get_db)
) -> list[DepartamentoResponse]:
    """Reutiliza el catálogo activo con autorización de Proveedores."""

    return list_departamentos(db)


@router.get(
    "/departamentos/{id_departamento}/municipios",
    response_model=list[MunicipioResponse],
)
def get_municipios(
    id_departamento: int,
    current_user: ProveedoresUser,
    db=Depends(get_db),
) -> list[MunicipioResponse]:
    """Reutiliza los municipios activos filtrados por departamento."""

    try:
        return list_municipios(db, id_departamento)
    except DepartamentoInactivoError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Departamento no encontrado o inactivo",
        ) from None


@router.get("", response_model=list[ProveedorResponse])
def get_proveedores(
    current_user: ProveedoresUser, db=Depends(get_db)
) -> list[ProveedorResponse]:
    """Lista proveedores activos e inactivos."""

    return list_proveedores(db)


@router.get("/{id_proveedor}", response_model=ProveedorResponse)
def get_proveedor_by_id(
    id_proveedor: int,
    current_user: ProveedoresUser,
    db=Depends(get_db),
) -> ProveedorResponse:
    """Consulta un proveedor por su identificador real."""

    proveedor = get_proveedor(db, id_proveedor)
    if proveedor is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return proveedor


@router.post("", response_model=ProveedorResponse, status_code=status.HTTP_201_CREATED)
def create_proveedor_route(
    data: ProveedorCreate,
    administrator: ProveedoresAdministrator,
    db=Depends(get_db),
) -> ProveedorResponse:
    """Registra un proveedor después de validar su municipio."""

    try:
        return create_proveedor(db, data)
    except MunicipioProveedorError:
        raise HTTPException(
            status_code=400,
            detail="El municipio debe existir y pertenecer a un departamento activo",
        ) from None
    except ProveedorConflictError:
        raise HTTPException(status_code=409, detail="No fue posible registrar el proveedor") from None


@router.put("/{id_proveedor}", response_model=ProveedorResponse)
def update_proveedor_route(
    id_proveedor: int,
    data: ProveedorUpdate,
    administrator: ProveedoresAdministrator,
    db=Depends(get_db),
) -> ProveedorResponse:
    """Edita los datos públicos de un proveedor existente."""

    proveedor = get_proveedor(db, id_proveedor)
    if proveedor is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    try:
        return update_proveedor(db, proveedor, data)
    except MunicipioProveedorError:
        raise HTTPException(
            status_code=400,
            detail="El municipio debe existir y pertenecer a un departamento activo",
        ) from None
    except ProveedorConflictError:
        raise HTTPException(status_code=409, detail="No fue posible actualizar el proveedor") from None


@router.patch("/{id_proveedor}/estado", response_model=ProveedorResponse)
def update_proveedor_estado_route(
    id_proveedor: int,
    data: ProveedorEstadoUpdate,
    administrator: ProveedoresAdministrator,
    db=Depends(get_db),
) -> ProveedorResponse:
    """Activa o inactiva un proveedor mediante una operación explícita."""

    proveedor = get_proveedor(db, id_proveedor)
    if proveedor is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    return set_proveedor_estado(db, proveedor, data.estado)


@router.delete("/{id_proveedor}", status_code=status.HTTP_204_NO_CONTENT)
def delete_proveedor_route(
    id_proveedor: int,
    administrator: ProveedoresAdministrator,
    db=Depends(get_db),
) -> None:
    """Elimina al proveedor solo cuando ninguna relación lo utiliza."""

    proveedor = get_proveedor(db, id_proveedor)
    if proveedor is None:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    try:
        delete_proveedor(db, proveedor)
    except ProveedorEnUsoError:
        raise HTTPException(
            status_code=409,
            detail="El proveedor tiene relaciones y no puede eliminarse. Puede inactivarlo.",
        ) from None
