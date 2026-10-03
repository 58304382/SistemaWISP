"""Rutas HTTP para visitas tecnicas, fotos y evaluaciones."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.visita_tecnica import (
    EstadoVisitaTecnica,
    EvaluacionVisitaCreate,
    EvaluacionVisitaDraft,
    EvaluacionVisitaFinalizar,
    EvaluacionVisitaResponse,
    PrimeraUbicacionVisitaCreate,
    VisitaTecnicaCreate,
    VisitaTecnicaResponse,
    VisitaTecnicaUpdate,
)
from app.schemas.ubicacion_cliente import UbicacionClienteResponse
from app.services.auth import ActiveSystemEmployee, require_module_access
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    ImageTooLargeError,
    InvalidImageError,
    read_image,
)
from app.services.visitas_tecnicas import (
    ClienteInactivoError,
    EmpleadoInactivoError,
    EmpleadoNotFoundError,
    EmpleadoSinPuestoTecnicoError,
    EstadoVisitaError,
    EvaluacionNotFoundError,
    TipoInstalacionInactivoError,
    UbicacionClienteInactivaError,
    UbicacionClienteNoPerteneceError,
    UbicacionClienteNotFoundError,
    UbicacionVisitaExistenteError,
    VisitaConflictError,
    VisitaNoAsignadaError,
    actualizar_evaluacion,
    create_visita,
    delete_visita,
    finalizar_evaluacion,
    get_visita,
    get_visita_model,
    iniciar_evaluacion,
    list_tecnicos_activos,
    list_visitas,
    remove_reference_photo,
    registrar_primera_ubicacion,
    replace_reference_photo,
    update_visita,
)


router = APIRouter(prefix="/api/visitas-tecnicas", tags=["visitas-tecnicas"])

VisitasUser = Annotated[Usuario, Depends(require_module_access("clientes"))]


def require_visitas_administrator(current_user: VisitasUser) -> Usuario:
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


VisitasAdministrator = Annotated[Usuario, Depends(require_visitas_administrator)]


def _business_error(error: Exception) -> HTTPException:
    if isinstance(error, VisitaNoAsignadaError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La visita está asignada a otro técnico",
        )
    if isinstance(error, ClienteInactivoError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El cliente debe existir y estar activo",
        )
    if isinstance(error, UbicacionClienteNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="La propiedad seleccionada no existe",
        )
    if isinstance(error, UbicacionClienteNoPerteneceError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La propiedad seleccionada no pertenece al cliente de la visita",
        )
    if isinstance(error, UbicacionClienteInactivaError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La propiedad seleccionada debe estar activa",
        )
    if isinstance(error, TipoInstalacionInactivoError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El tipo de instalación debe existir y estar activo",
        )
    if isinstance(error, EmpleadoNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empleado no encontrado",
        )
    if isinstance(error, EmpleadoInactivoError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El empleado y su puesto deben estar activos",
        )
    if isinstance(error, EmpleadoSinPuestoTecnicoError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El empleado debe tener el puesto Técnico",
        )
    if isinstance(error, EvaluacionNotFoundError):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evaluación de visita no encontrada",
        )
    if isinstance(error, EstadoVisitaError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El estado actual de la visita no permite esta operación",
        )
    if isinstance(error, UbicacionVisitaExistenteError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La visita ya tiene una propiedad registrada",
        )
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="La operación entra en conflicto con otro registro",
    )


def _image_error(error: Exception) -> HTTPException:
    if isinstance(error, ImageTooLargeError):
        return HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen supera el tamaño permitido",
        )
    if isinstance(error, InvalidImageError):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo no es una imagen válida",
        )
    if isinstance(error, ImagePathError):
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La ruta almacenada para la imagen no es válida",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="No se pudo almacenar la imagen",
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Visita técnica no encontrada"
    )


@router.get("/tecnicos", response_model=list[dict[str, Any]])
def get_tecnicos(
    current_user: VisitasUser,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return list_tecnicos_activos(db)


@router.get("", response_model=list[VisitaTecnicaResponse])
def get_visitas(
    current_user: VisitasUser,
    estado: EstadoVisitaTecnica | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return list_visitas(db, estado)


@router.get("/{id_visita}", response_model=VisitaTecnicaResponse)
def get_visita_by_id(
    id_visita: int,
    current_user: VisitasUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita(db, id_visita)
    if visit is None:
        raise _not_found()
    return visit


@router.post(
    "", response_model=VisitaTecnicaResponse, status_code=status.HTTP_201_CREATED
)
async def create_visita_route(
    data: Annotated[VisitaTecnicaCreate, Depends(VisitaTecnicaCreate.as_form)],
    administrator: VisitasAdministrator,
    foto_referencia: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        photo_content = (
            None if foto_referencia is None else await read_image(foto_referencia)
        )
        return create_visita(db, data, photo_content)
    except (
        ClienteInactivoError,
        UbicacionClienteNotFoundError,
        UbicacionClienteNoPerteneceError,
        UbicacionClienteInactivaError,
        TipoInstalacionInactivoError,
        EmpleadoNotFoundError,
        EmpleadoInactivoError,
        EmpleadoSinPuestoTecnicoError,
        VisitaConflictError,
    ) as error:
        raise _business_error(error) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None


@router.patch("/{id_visita}", response_model=VisitaTecnicaResponse)
def update_visita_route(
    id_visita: int,
    data: VisitaTecnicaUpdate,
    administrator: VisitasAdministrator,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita_model(db, id_visita)
    if visit is None:
        raise _not_found()
    try:
        return update_visita(db, visit, data)
    except (
        ClienteInactivoError,
        UbicacionClienteNotFoundError,
        UbicacionClienteNoPerteneceError,
        UbicacionClienteInactivaError,
        TipoInstalacionInactivoError,
        EmpleadoNotFoundError,
        EmpleadoInactivoError,
        EmpleadoSinPuestoTecnicoError,
        EstadoVisitaError,
        VisitaConflictError,
    ) as error:
        raise _business_error(error) from None


@router.post(
    "/{id_visita}/ubicacion",
    response_model=UbicacionClienteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_first_location(
    id_visita: int,
    data: Annotated[
        PrimeraUbicacionVisitaCreate, Depends(PrimeraUbicacionVisitaCreate.as_form)
    ],
    current_user: VisitasUser,
    current_employee: ActiveSystemEmployee,
    foto_fachada: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        image_content = None if foto_fachada is None else await read_image(foto_fachada)
        location = registrar_primera_ubicacion(
            db,
            id_visita,
            data,
            current_employee_id=current_employee.id_empleado,
            image_content=image_content,
        )
    except (
        VisitaNoAsignadaError,
        EstadoVisitaError,
        UbicacionVisitaExistenteError,
        VisitaConflictError,
    ) as error:
        raise _business_error(error) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None
    if location is None:
        raise _not_found()
    return location


@router.delete("/{id_visita}", response_model=VisitaTecnicaResponse)
def delete_visita_route(
    id_visita: int,
    administrator: VisitasAdministrator,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita_model(db, id_visita)
    if visit is None:
        raise _not_found()
    try:
        return delete_visita(db, visit)
    except (EstadoVisitaError, VisitaConflictError) as error:
        raise _business_error(error) from None
    except (ImagePathError, ImageStorageError) as error:
        raise _image_error(error) from None


@router.put("/{id_visita}/foto-referencia", response_model=VisitaTecnicaResponse)
async def put_reference_photo(
    id_visita: int,
    administrator: VisitasAdministrator,
    foto_referencia: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita_model(db, id_visita)
    if visit is None:
        raise _not_found()
    try:
        content = await read_image(foto_referencia)
        return replace_reference_photo(db, visit, content)
    except EstadoVisitaError as error:
        raise _business_error(error) from None
    except (
        ImageTooLargeError,
        InvalidImageError,
        ImageStorageError,
        ImagePathError,
    ) as error:
        raise _image_error(error) from None


@router.delete("/{id_visita}/foto-referencia", response_model=VisitaTecnicaResponse)
def delete_reference_photo(
    id_visita: int,
    administrator: VisitasAdministrator,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita_model(db, id_visita)
    if visit is None:
        raise _not_found()
    try:
        return remove_reference_photo(db, visit)
    except EstadoVisitaError as error:
        raise _business_error(error) from None
    except (ImageStorageError, ImagePathError) as error:
        raise _image_error(error) from None


@router.post(
    "/{id_visita}/evaluacion",
    response_model=VisitaTecnicaResponse,
    status_code=status.HTTP_201_CREATED,
)
def initiate_evaluation(
    id_visita: int,
    data: EvaluacionVisitaCreate,
    current_user: VisitasUser,
    current_employee: ActiveSystemEmployee,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        visit = iniciar_evaluacion(
            db, id_visita, data, current_employee.id_empleado
        )
    except (EstadoVisitaError, VisitaConflictError, VisitaNoAsignadaError) as error:
        raise _business_error(error) from None
    if visit is None:
        raise _not_found()
    return visit


@router.get("/{id_visita}/evaluacion", response_model=EvaluacionVisitaResponse)
def get_evaluation(
    id_visita: int,
    current_user: VisitasUser,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    visit = get_visita(db, id_visita)
    if visit is None:
        raise _not_found()
    if visit["evaluacion"] is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evaluación de visita no encontrada",
        )
    return visit["evaluacion"]


@router.patch("/{id_visita}/evaluacion", response_model=VisitaTecnicaResponse)
def continue_evaluation(
    id_visita: int,
    data: EvaluacionVisitaDraft,
    current_user: VisitasUser,
    current_employee: ActiveSystemEmployee,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        visit = actualizar_evaluacion(
            db, id_visita, data, current_employee.id_empleado
        )
    except (
        EstadoVisitaError,
        EvaluacionNotFoundError,
        VisitaConflictError,
        VisitaNoAsignadaError,
    ) as error:
        raise _business_error(error) from None
    if visit is None:
        raise _not_found()
    return visit


@router.post(
    "/{id_visita}/evaluacion/finalizar", response_model=VisitaTecnicaResponse
)
def finish_evaluation(
    id_visita: int,
    data: EvaluacionVisitaFinalizar,
    current_user: VisitasUser,
    current_employee: ActiveSystemEmployee,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        visit = finalizar_evaluacion(
            db,
            id_visita,
            data,
            current_employee_id=current_employee.id_empleado,
            current_user_id=current_user.id,
        )
    except (
        EstadoVisitaError,
        EvaluacionNotFoundError,
        VisitaConflictError,
        VisitaNoAsignadaError,
    ) as error:
        raise _business_error(error) from None
    if visit is None:
        raise _not_found()
    return visit
