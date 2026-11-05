"""Rutas HTTP para autenticacion y consulta de la sesion actual."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.database import get_db
from app.modules.auth.schemas.auth import LoginRequest, TokenResponse
from app.modules.auth.services.auth import CurrentUser, authenticate_user, build_token
from app.modules.usuarios.schemas.usuario import UsuarioResponse


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(credentials: LoginRequest, db=Depends(get_db)) -> TokenResponse:
    usuario = authenticate_user(db, credentials.username, credentials.password)
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenResponse(access_token=build_token(usuario))


@router.get("/me", response_model=UsuarioResponse)
def me(current_user: CurrentUser) -> UsuarioResponse:
    return current_user
