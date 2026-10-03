"""Ruta protegida de consulta para tipos de instalacion activos."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.tipo_instalacion import TipoInstalacionResponse
from app.services.auth import require_module_access
from app.services.tipos_instalacion import list_tipos_instalacion_activos


router = APIRouter(prefix="/api/tipos-instalacion", tags=["tipos-instalacion"])
TiposUser = Annotated[Usuario, Depends(require_module_access("clientes"))]


@router.get("", response_model=list[TipoInstalacionResponse])
def get_tipos_instalacion(
    current_user: TiposUser,
    db: Session = Depends(get_db),
) -> list[TipoInstalacionResponse]:
    """Lista el catalogo activo sin exponer un CRUD que el flujo actual no necesita."""

    return list_tipos_instalacion_activos(db)
