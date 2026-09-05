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
        .where(Usuario.id == user_id, Usuario.activo.is_(True))
    )
    if usuario is None:
        raise credentials_exception
    return usuario


CurrentUser = Annotated[Usuario, Depends(get_current_user)]


def require_administrator(current_user: CurrentUser) -> Usuario:
    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere el rol Administrador",
        )
    return current_user


Administrator = Annotated[Usuario, Depends(require_administrator)]
