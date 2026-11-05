"""Lectura unificada y autorizada del trabajo técnico."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.modules.usuarios.models.usuario import Usuario
from app.modules.tareas.schemas.tarea import TareaResponse
from app.modules.auth.services.auth import ActiveSystemEmployee, require_module_access
from app.modules.tareas.services.tareas import list_tareas


router = APIRouter(prefix="/api/tareas", tags=["tareas"])
TareasModuleUser = Annotated[Usuario, Depends(require_module_access("clientes"))]


@router.get("", response_model=list[TareaResponse])
def get_tareas(
    current_user: TareasModuleUser,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> list[TareaResponse]:
    """No acepta IDs laborales: la visibilidad parte del usuario autenticado."""

    return list_tareas(
        db,
        current_employee,
        actions_enabled=current_user.rol.nombre == "Administrador",
    )
