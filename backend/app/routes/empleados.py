"""Rutas HTTP protegidas para empleados y sus fotografias."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.database import get_db
from app.schemas.cliente import DepartamentoResponse, MunicipioResponse
from app.schemas.empleado import (
    EmpleadoCreate,
    EmpleadoResponse,
    EmpleadoUpdate,
    PuestoEmpleadoResponse,
)
from app.services.auth import Administrator
from app.services.empleados import (
    EmpleadoConflictError,
    InvalidPhotoError,
    MunicipioInactivoError,
    PhotoPathError,
    PhotoStorageError,
    PhotoTooLargeError,
    PuestoInactivoError,
    create_empleado,
    delete_empleado,
    get_empleado,
    get_empleado_model,
    list_departamentos,
    list_empleados,
    list_municipios,
    list_puestos_activos,
    remove_empleado_photo,
    replace_empleado_photo,
    update_empleado,
)


router = APIRouter(prefix="/api/empleados", tags=["empleados"])


def _photo_error(error: Exception) -> HTTPException:
    if isinstance(error, PhotoTooLargeError):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La fotografía supera el límite máximo de 5 MB",
        )
    if isinstance(error, InvalidPhotoError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fotografía debe ser una imagen JPEG, PNG o WEBP válida",
        )
    if isinstance(error, PhotoPathError):
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La ruta de la fotografía almacenada no es válida",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="No se pudo almacenar la fotografía",
    )


async def _read_photo(photo: UploadFile | None) -> bytes | None:
    if photo is None:
        return None
    return await photo.read(5 * 1024 * 1024 + 1)


@router.get("/puestos", response_model=list[PuestoEmpleadoResponse])
def get_puestos(current_user: Administrator, db=Depends(get_db)) -> list[PuestoEmpleadoResponse]:
    return list_puestos_activos(db)


@router.get("/departamentos", response_model=list[DepartamentoResponse])
def get_departamentos(
    current_user: Administrator,
    db=Depends(get_db),
) -> list[DepartamentoResponse]:
    return list_departamentos(db)


@router.get(
    "/departamentos/{id_departamento}/municipios",
    response_model=list[MunicipioResponse],
)
def get_municipios(
    id_departamento: int,
    current_user: Administrator,
    db=Depends(get_db),
) -> list[MunicipioResponse]:
    try:
        return list_municipios(db, id_departamento)
    except MunicipioInactivoError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Departamento no encontrado o inactivo",
        ) from None


@router.get("", response_model=list[EmpleadoResponse])
def get_empleados(
    current_user: Administrator,
    db=Depends(get_db),
) -> list[EmpleadoResponse]:
    return list_empleados(db)


@router.get("/{id_empleado}", response_model=EmpleadoResponse)
def get_empleado_by_id(
    id_empleado: int,
    current_user: Administrator,
    db=Depends(get_db),
) -> EmpleadoResponse:
    employee = get_empleado(db, id_empleado)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empleado no encontrado")
    return employee


@router.post("", response_model=EmpleadoResponse, status_code=status.HTTP_201_CREATED)
async def create_empleado_route(
    data: Annotated[EmpleadoCreate, Depends(EmpleadoCreate.as_form)],
    administrator: Administrator,
    foto: UploadFile | None = File(None),
    db=Depends(get_db),
) -> EmpleadoResponse:
    try:
        return create_empleado(db, data, await _read_photo(foto))
    except (PuestoInactivoError, MunicipioInactivoError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El puesto y el municipio deben existir y estar activos",
        ) from None
    except EmpleadoConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El número de documento o código ya está registrado",
        ) from None
    except (PhotoTooLargeError, InvalidPhotoError, PhotoStorageError) as error:
        raise _photo_error(error) from None


@router.patch("/{id_empleado}", response_model=EmpleadoResponse)
def update_empleado_route(
    id_empleado: int,
    data: EmpleadoUpdate,
    administrator: Administrator,
    db=Depends(get_db),
) -> EmpleadoResponse:
    employee = get_empleado_model(db, id_empleado)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empleado no encontrado")
    try:
        return update_empleado(db, employee, data)
    except (PuestoInactivoError, MunicipioInactivoError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El puesto y el municipio deben existir y estar activos",
        ) from None
    except EmpleadoConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El número de documento ya está registrado",
        ) from None


@router.delete("/{id_empleado}", response_model=EmpleadoResponse)
def delete_empleado_route(
    id_empleado: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> EmpleadoResponse:
    employee = get_empleado_model(db, id_empleado)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empleado no encontrado")
    return delete_empleado(db, employee)


@router.put("/{id_empleado}/foto", response_model=EmpleadoResponse)
async def replace_empleado_photo_route(
    id_empleado: int,
    administrator: Administrator,
    foto: UploadFile = File(...),
    db=Depends(get_db),
) -> EmpleadoResponse:
    employee = get_empleado_model(db, id_empleado)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empleado no encontrado")
    try:
        photo_content = await _read_photo(foto)
        if photo_content is None:
            raise InvalidPhotoError
        return replace_empleado_photo(db, employee, photo_content)
    except (PhotoTooLargeError, InvalidPhotoError, PhotoStorageError, PhotoPathError) as error:
        raise _photo_error(error) from None


@router.delete("/{id_empleado}/foto", response_model=EmpleadoResponse)
def remove_empleado_photo_route(
    id_empleado: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> EmpleadoResponse:
    employee = get_empleado_model(db, id_empleado)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Empleado no encontrado")
    try:
        return remove_empleado_photo(db, employee)
    except (PhotoStorageError, PhotoPathError) as error:
        raise _photo_error(error) from None
