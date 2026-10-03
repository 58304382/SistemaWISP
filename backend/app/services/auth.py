from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    verify_password,
)
from app.models.empleado import Empleado
from app.models.usuario import Usuario


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
DbSession = Annotated[Session, Depends(get_db)]
BearerToken = Annotated[str, Depends(oauth2_scheme)]


def authenticate_user(db: Session, username: str, password: str) -> Usuario | None:
    usuario = db.scalar(
        select(Usuario)
        .options(joinedload(Usuario.rol))
        .where(Usuario.username == username)
    )
    if usuario is None or not usuario.activo:
        return None
    if not verify_password(password, usuario.password_hash):
        return None
    return usuario


def build_token(usuario: Usuario) -> str:
    return create_access_token(
        subject=str(usuario.id),
        username=usuario.username,
        role=usuario.rol.nombre,
    )


def get_current_user(db: DbSession, token: BearerToken) -> Usuario:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        user_id = int(subject)
    except (ValueError, TypeError, jwt.InvalidTokenError):
        raise credentials_exception from None

    usuario = db.scalar(
        select(Usuario)
        .options(joinedload(Usuario.rol))
        # La identidad laboral se resuelve siempre desde la relación vigente
        # en PostgreSQL; no se aceptan IDs o puestos enviados por el cliente.
        .options(joinedload(Usuario.empleado).joinedload(Empleado.puesto))
        .where(Usuario.id == user_id, Usuario.activo.is_(True))
    )
    if usuario is None:
        raise credentials_exception
    return usuario


CurrentUser = Annotated[Usuario, Depends(get_current_user)]


def get_current_employee(current_user: CurrentUser) -> Empleado:
    """Exige que la cuenta autenticada tenga una identidad laboral asociada."""

    if current_user.empleado is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El usuario no tiene un empleado asociado",
        )
    return current_user.empleado


CurrentEmployee = Annotated[Empleado, Depends(get_current_employee)]


def require_active_system_employee(current_employee: CurrentEmployee) -> Empleado:
    """Valida que el empleado y su puesto puedan ejercer funciones del sistema."""

    if current_employee.estado != "Activo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El empleado asociado está inactivo",
        )
    if current_employee.puesto is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El empleado asociado no tiene un puesto válido",
        )
    if current_employee.puesto.estado != "Activo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El puesto del empleado asociado está inactivo",
        )
    if not current_employee.puesto.tiene_funciones_sistema:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El puesto del empleado no tiene funciones en SistemaWISP",
        )
    return current_employee


ActiveSystemEmployee = Annotated[Empleado, Depends(require_active_system_employee)]


def require_administrator(current_user: CurrentUser) -> Usuario:
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


Administrator = Annotated[Usuario, Depends(require_administrator)]


def require_module_access(
    module_code: str,
    *,
    administrator_bypass: bool = False,
) -> Callable[[CurrentUser], Usuario]:
    """Build a reusable dependency for an active user-module assignment."""

    def dependency(current_user: CurrentUser) -> Usuario:
        has_access = any(
            modulo.codigo == module_code and modulo.activo for modulo in current_user.modulos
        )
        if not has_access and not (administrator_bypass and current_user.rol.nombre == "Administrador"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para acceder a este módulo",
            )
        return current_user

    return dependency
