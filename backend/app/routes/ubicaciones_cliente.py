"""Protected HTTP routes for customer locations and facade images."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.ubicacion_cliente import (
    UbicacionClienteCreate,
    UbicacionClienteResponse,
    UbicacionClienteUpdate,
)
from app.services.auth import require_module_access
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    ImageTooLargeError,
    InvalidImageError,
    read_image,
)
from app.services.ubicaciones_cliente import (
    ClienteNotFoundError,
    UbicacionClienteConflictError,
    create_ubicacion_cliente,
    get_ubicacion_cliente,
    get_ubicacion_cliente_model,
    list_ubicaciones_cliente,
    list_ubicaciones_mapa,
    remove_ubicacion_cliente_image,
    replace_ubicacion_cliente_image,
    update_ubicacion_cliente,
)


router = APIRouter(prefix="/api/ubicaciones-cliente", tags=["ubicaciones-cliente"])

ClientesUser = Annotated[Usuario, Depends(require_module_access("clientes"))]
MapasUser = Annotated[Usuario, Depends(require_module_access("mapas"))]


def require_ubicaciones_administrator(current_user: ClientesUser) -> Usuario:
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


UbicacionesAdministrator = Annotated[
    Usuario, Depends(require_ubicaciones_administrator)
]


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


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Ubicación de cliente no encontrada",
    )


@router.get("", response_model=list[UbicacionClienteResponse])
def get_ubicaciones_mapa(
    current_user: MapasUser,
    db=Depends(get_db),
) -> list[UbicacionClienteResponse]:
    """Expone todas las propiedades sin duplicarlas ni alterar su estado."""

    return list_ubicaciones_mapa(db)


@router.get(
    "/cliente/{id_cliente}", response_model=list[UbicacionClienteResponse]
)
def get_ubicaciones_by_cliente(
    id_cliente: int,
    current_user: ClientesUser,
    db=Depends(get_db),
) -> list[UbicacionClienteResponse]:
    try:
        return list_ubicaciones_cliente(db, id_cliente)
    except ClienteNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado"
        ) from None


@router.get("/{id_ubicacion}", response_model=UbicacionClienteResponse)
def get_ubicacion_by_id(
    id_ubicacion: int,
    current_user: ClientesUser,
    db=Depends(get_db),
) -> UbicacionClienteResponse:
    location = get_ubicacion_cliente(db, id_ubicacion)
    if location is None:
        raise _not_found()
    return location


@router.post(
    "", response_model=UbicacionClienteResponse, status_code=status.HTTP_201_CREATED
)
async def create_ubicacion_route(
    data: Annotated[UbicacionClienteCreate, Depends(UbicacionClienteCreate.as_form)],
    administrator: UbicacionesAdministrator,
    foto: UploadFile | None = File(None),
    db=Depends(get_db),
) -> UbicacionClienteResponse:
    try:
        image_content = None if foto is None else await read_image(foto)
        return create_ubicacion_cliente(db, data, image_content)
    except ClienteNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no existe"
        ) from None
    except UbicacionClienteConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ubicación entra en conflicto con los datos existentes",
        ) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None


@router.patch("/{id_ubicacion}", response_model=UbicacionClienteResponse)
def update_ubicacion_route(
    id_ubicacion: int,
    data: UbicacionClienteUpdate,
    administrator: UbicacionesAdministrator,
    db=Depends(get_db),
) -> UbicacionClienteResponse:
    location = get_ubicacion_cliente_model(db, id_ubicacion)
    if location is None:
        raise _not_found()
    try:
        return update_ubicacion_cliente(db, location, data)
    except ClienteNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no existe"
        ) from None
    except UbicacionClienteConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La ubicación entra en conflicto con los datos existentes",
        ) from None


@router.put("/{id_ubicacion}/foto", response_model=UbicacionClienteResponse)
async def replace_ubicacion_photo_route(
    id_ubicacion: int,
    administrator: UbicacionesAdministrator,
    foto: UploadFile = File(...),
    db=Depends(get_db),
) -> UbicacionClienteResponse:
    location = get_ubicacion_cliente_model(db, id_ubicacion)
    if location is None:
        raise _not_found()
    try:
        return replace_ubicacion_cliente_image(db, location, await read_image(foto))
    except UbicacionClienteConflictError:
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


@router.delete("/{id_ubicacion}/foto", response_model=UbicacionClienteResponse)
def remove_ubicacion_photo_route(
    id_ubicacion: int,
    administrator: UbicacionesAdministrator,
    db=Depends(get_db),
) -> UbicacionClienteResponse:
    location = get_ubicacion_cliente_model(db, id_ubicacion)
    if location is None:
        raise _not_found()
    try:
        return remove_ubicacion_cliente_image(db, location)
    except UbicacionClienteConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo quitar la fotografía por un conflicto de datos",
        ) from None
    except (ImageStorageError, ImagePathError) as error:
        raise _image_error(error) from None
