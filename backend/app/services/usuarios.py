"""Reglas de negocio y consultas del módulo de usuarios."""

# ==========================================
# IMPORTS
# ==========================================
from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.security import get_password_hash
from app.models.modulo import Modulo
from app.models.rol import Rol
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioCreate, UsuarioUpdate


# ==========================================
# ERRORES DE DOMINIO
# ==========================================
class UsuarioConflictError(Exception):
    pass


class RolNotFoundError(Exception):
    pass


class ModulosInvalidosError(Exception):
    pass


# ==========================================
# CONSULTAS
# ==========================================
def list_usuarios(db: Session) -> list[Usuario]:
    return list(
        db.scalars(
            select(Usuario)
            .options(joinedload(Usuario.rol))
            .options(selectinload(Usuario.modulos))
            .order_by(Usuario.id)
        ).all()
    )


def get_usuario(db: Session, usuario_id: int) -> Usuario | None:
    return db.scalar(
        select(Usuario)
        .options(joinedload(Usuario.rol))
        .options(selectinload(Usuario.modulos))
        .where(Usuario.id == usuario_id)
    )


# ==========================================
# VALIDACIONES
# ==========================================
def _ensure_role_exists(db: Session, rol_id: int) -> None:
    if db.scalar(select(Rol.id).where(Rol.id == rol_id)) is None:
        raise RolNotFoundError


def _ensure_unique_username(
    db: Session,
    username: str,
    usuario_id: int | None = None,
) -> None:
    query = select(Usuario.id).where(Usuario.username == username)
    if usuario_id is not None:
        query = query.where(Usuario.id != usuario_id)
    if db.scalar(query) is not None:
        raise UsuarioConflictError


def _get_modules(db: Session, module_ids: list[int]) -> list[Modulo]:
    unique_ids = set(module_ids)
    if len(unique_ids) < 2:
        raise ModulosInvalidosError

    modules = list(
        db.scalars(
            select(Modulo).where(Modulo.id.in_(unique_ids), Modulo.activo.is_(True))
        ).all()
    )
    if len(modules) != len(unique_ids):
        raise ModulosInvalidosError
    return modules


def list_modulos(db: Session) -> list[Modulo]:
    return list(db.scalars(select(Modulo).where(Modulo.activo.is_(True)).order_by(Modulo.id)).all())


# ==========================================
# OPERACIONES DE USUARIO
# ==========================================
def create_usuario(db: Session, data: UsuarioCreate) -> Usuario:
    _ensure_role_exists(db, data.rol_id)
    _ensure_unique_username(db, data.username)
    modules = _get_modules(db, data.modulo_ids)

    usuario = Usuario(
        nombre=data.nombre,
        apellido=data.apellido,
        username=data.username,
        password_hash=get_password_hash(data.password),
        rol_id=data.rol_id,
        activo=data.activo,
    )
    usuario.modulos = modules
    db.add(usuario)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise UsuarioConflictError from exc
    db.refresh(usuario)
    return get_usuario(db, usuario.id)  # type: ignore[return-value]


def update_usuario(
    db: Session,
    usuario: Usuario,
    data: UsuarioUpdate,
) -> Usuario:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    username = values.get("username", usuario.username)
    _ensure_unique_username(db, username, usuario.id)

    if "rol_id" in values:
        _ensure_role_exists(db, values["rol_id"])

    if "modulo_ids" in values:
        usuario.modulos = _get_modules(db, values["modulo_ids"])

    for field in ("nombre", "apellido", "username", "rol_id", "activo"):
        if field in values:
            setattr(usuario, field, values[field])
    if "password" in values:
        usuario.password_hash = get_password_hash(values["password"])
    usuario.updated_at = func.now()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise UsuarioConflictError from exc
    db.refresh(usuario)
    return get_usuario(db, usuario.id)  # type: ignore[return-value]
