"""Rutas protegidas del catalogo de tipos de instalacion."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.services.auth import Administrator, require_module_access
from app.modules.usuarios.models.usuario import Usuario
from app.modules.visitas_tecnicas.schemas.tipo_instalacion import (
    TipoInstalacionCreate,
    TipoInstalacionResponse,
    TipoInstalacionUpdate,
)
from app.modules.visitas_tecnicas.services.tipos_instalacion import (
    TipoInstalacionDuplicateError,
    TipoInstalacionEnUsoError,
    TipoInstalacionNotFoundError,
    create_tipo_instalacion,
    get_tipo_instalacion,
    list_tipos_instalacion,
    list_tipos_instalacion_activos,
    update_tipo_instalacion,
)


router = APIRouter(prefix="/api/tipos-instalacion", tags=["tipos-instalacion"])
TiposUser = Annotated[Usuario, Depends(require_module_access("clientes"))]
TipoInstalacionId = Annotated[int, Path(gt=0)]


def _catalogo_error(error: Exception) -> HTTPException:
    """Traduce errores del catalogo sin exponer detalles de PostgreSQL."""

    if isinstance(error, TipoInstalacionNotFoundError):
        return HTTPException(status_code=404, detail="Tipo de instalacion no encontrado")
    if isinstance(error, TipoInstalacionDuplicateError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El nombre del tipo de instalacion ya esta registrado",
        )
    if isinstance(error, TipoInstalacionEnUsoError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error) or (
                "No se puede inactivar el tipo porque existen visitas o "
                "instalaciones en proceso que lo utilizan"
            ),
        )
    raise error


def _tipo_or_404(db: Session, id_tipo_instalacion: int):
    tipo = get_tipo_instalacion(db, id_tipo_instalacion)
    if tipo is None:
        raise HTTPException(status_code=404, detail="Tipo de instalacion no encontrado")
    return tipo


@router.get("", response_model=list[TipoInstalacionResponse])
def get_tipos_instalacion(
    current_user: TiposUser,
    db: Session = Depends(get_db),
) -> list[TipoInstalacionResponse]:
    """Conserva el catalogo activo consumido por Visitas e Instalaciones."""

    return list_tipos_instalacion_activos(db)


@router.get("/todos", response_model=list[TipoInstalacionResponse])
def get_todos_tipos_instalacion(
    administrator: Administrator,
    db: Session = Depends(get_db),
) -> list[TipoInstalacionResponse]:
    """Lista activos e inactivos para la pantalla administrativa."""

    return list_tipos_instalacion(db, incluir_inactivos=True)


@router.post(
    "",
    response_model=TipoInstalacionResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_tipo_instalacion(
    data: TipoInstalacionCreate,
    administrator: Administrator,
    db: Session = Depends(get_db),
) -> TipoInstalacionResponse:
    """Registra un tipo nuevo exclusivamente bajo autorizacion administrativa."""

    try:
        return create_tipo_instalacion(db, data)
    except (TipoInstalacionDuplicateError, TipoInstalacionEnUsoError) as error:
        raise _catalogo_error(error) from None


@router.patch("/{id_tipo_instalacion}", response_model=TipoInstalacionResponse)
def patch_tipo_instalacion(
    id_tipo_instalacion: TipoInstalacionId,
    data: TipoInstalacionUpdate,
    administrator: Administrator,
    db: Session = Depends(get_db),
) -> TipoInstalacionResponse:
    """Edita datos o cambia el estado sin eliminar el registro fisico."""

    tipo = _tipo_or_404(db, id_tipo_instalacion)
    try:
        return update_tipo_instalacion(db, tipo, data)
    except (
        TipoInstalacionDuplicateError,
        TipoInstalacionEnUsoError,
        TipoInstalacionNotFoundError,
    ) as error:
        raise _catalogo_error(error) from None
