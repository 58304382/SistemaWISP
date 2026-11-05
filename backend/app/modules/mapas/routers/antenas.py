"""Endpoints protegidos del catálogo geográfico de antenas."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.database import get_db
from app.modules.usuarios.models.usuario import Usuario
from app.modules.mapas.schemas.antena import AntenaCreate, AntenaResponse, AntenaUpdate
from app.modules.mapas.services.antenas import (
    AntenaConflictError,
    create_antena,
    delete_antena,
    get_antena,
    get_antena_model,
    list_antenas,
    remove_antena_image,
    replace_antena_image,
    update_antena,
)
from app.modules.auth.services.auth import require_module_access
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    ImageTooLargeError,
    InvalidImageError,
    read_image,
)


router = APIRouter(prefix="/api/antenas", tags=["antenas"])
MapasUser = Annotated[Usuario, Depends(require_module_access("mapas"))]


def require_antenas_administrator(current_user: MapasUser) -> Usuario:
    """Restringe la administración de antenas al Administrador con acceso a Mapas."""

    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


MapasAdministrator = Annotated[Usuario, Depends(require_antenas_administrator)]


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Antena no encontrada")


def _image_error(error: Exception) -> HTTPException:
    if isinstance(error, ImageTooLargeError):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La fotografía supera el límite máximo de 5 MB",
        )
    if isinstance(error, InvalidImageError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fotografía debe ser una imagen JPEG, PNG o WEBP válida",
        )
    if isinstance(error, ImagePathError):
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La ruta almacenada de la fotografía no es válida",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="No se pudo almacenar la fotografía",
    )


@router.get("", response_model=list[AntenaResponse])
def get_antenas(
    current_user: MapasUser,
    db=Depends(get_db),
) -> list[AntenaResponse]:
    return list_antenas(db)


@router.get("/{id_antena}", response_model=AntenaResponse)
def get_antena_by_id(
    id_antena: int,
    current_user: MapasUser,
    db=Depends(get_db),
) -> AntenaResponse:
    antenna = get_antena(db, id_antena)
    if antenna is None:
        raise _not_found()
    return antenna


@router.post("", response_model=AntenaResponse, status_code=status.HTTP_201_CREATED)
async def create_antena_route(
    data: Annotated[AntenaCreate, Depends(AntenaCreate.as_form)],
    administrator: MapasAdministrator,
    foto: UploadFile | None = File(None),
    db=Depends(get_db),
) -> AntenaResponse:
    try:
        image_content = None if foto is None else await read_image(foto)
        return create_antena(db, data, image_content)
    except AntenaConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La antena entra en conflicto con los datos existentes",
        ) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None


@router.patch("/{id_antena}", response_model=AntenaResponse)
def update_antena_route(
    id_antena: int,
    data: AntenaUpdate,
    administrator: MapasAdministrator,
    db=Depends(get_db),
) -> AntenaResponse:
    antenna = get_antena_model(db, id_antena)
    if antenna is None:
        raise _not_found()
    try:
        return update_antena(db, antenna, data)
    except AntenaConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La antena entra en conflicto con los datos existentes",
        ) from None


@router.delete("/{id_antena}", status_code=status.HTTP_204_NO_CONTENT)
def delete_antena_route(
    id_antena: int,
    administrator: MapasAdministrator,
    db=Depends(get_db),
) -> None:
    """Elimina una antena sin propagar el borrado a registros relacionados."""

    antenna = get_antena_model(db, id_antena)
    if antenna is None:
        raise _not_found()
    try:
        delete_antena(db, antenna)
    except AntenaConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar la antena porque está relacionada con otros registros",
        ) from None
    except (ImageStorageError, ImagePathError) as error:
        raise _image_error(error) from None


@router.put("/{id_antena}/foto", response_model=AntenaResponse)
async def replace_antena_photo_route(
    id_antena: int,
    administrator: MapasAdministrator,
    foto: UploadFile = File(...),
    db=Depends(get_db),
) -> AntenaResponse:
    antenna = get_antena_model(db, id_antena)
    if antenna is None:
        raise _not_found()
    try:
        return replace_antena_image(db, antenna, await read_image(foto))
    except AntenaConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo actualizar la fotografía por un conflicto de datos",
        ) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None


@router.delete("/{id_antena}/foto", response_model=AntenaResponse)
def remove_antena_photo_route(
    id_antena: int,
    administrator: MapasAdministrator,
    db=Depends(get_db),
) -> AntenaResponse:
    antenna = get_antena_model(db, id_antena)
    if antenna is None:
        raise _not_found()
    try:
        return remove_antena_image(db, antenna)
    except AntenaConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo quitar la fotografía por un conflicto de datos",
        ) from None
    except (ImageStorageError, ImagePathError) as error:
        raise _image_error(error) from None
