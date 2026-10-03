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
from app.models.empleado import Empleado
from app.models.modulo import Modulo
from app.models.puesto_empleado import PuestoEmpleado
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


class EmpleadoNotFoundError(Exception):
    pass


class EmpleadoInactivoError(Exception):
    pass


class PuestoInactivoError(Exception):
    pass


class PuestoSinFuncionesError(Exception):
    pass


class EmpleadoAlreadyLinkedError(Exception):
    pass


# ==========================================
# CONSULTAS
# ==========================================
def list_usuarios(db: Session) -> list[Usuario]:
    return list(
        db.scalars(
            select(Usuario)
            .options(joinedload(Usuario.rol))
            .options(joinedload(Usuario.empleado).joinedload(Empleado.puesto))
            .options(selectinload(Usuario.modulos))
            .order_by(Usuario.id)
        ).all()
    )


def get_usuario(db: Session, usuario_id: int) -> Usuario | None:
    return db.scalar(
        select(Usuario)
        .options(joinedload(Usuario.rol))
        .options(joinedload(Usuario.empleado).joinedload(Empleado.puesto))
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


def list_empleados_disponibles(db: Session) -> list[dict[str, Any]]:
    """Lista únicamente empleados elegibles y aún no vinculados a una cuenta."""

    employees = db.scalars(
        select(Empleado)
        .join(Empleado.puesto)
        .options(joinedload(Empleado.puesto))
        .where(
            Empleado.estado == "Activo",
            Empleado.id_usuario.is_(None),
            PuestoEmpleado.estado == "Activo",
            PuestoEmpleado.tiene_funciones_sistema.is_(True),
        )
        .order_by(Empleado.apellidos, Empleado.nombres, Empleado.id_empleado)
    ).unique().all()
    return [
        {
            "id_empleado": employee.id_empleado,
            "codigo": employee.codigo,
            "nombres": employee.nombres,
            "apellidos": employee.apellidos,
            "id_puesto": employee.id_puesto,
            "nombre_puesto": employee.puesto.nombre,
        }
        for employee in employees
    ]


def _lock_employee_for_user_creation(db: Session, id_empleado: int) -> Empleado:
    employee = db.scalar(
        select(Empleado)
        .options(joinedload(Empleado.puesto))
        .where(Empleado.id_empleado == id_empleado)
        .with_for_update(of=Empleado)
    )
    if employee is None:
        raise EmpleadoNotFoundError
    if employee.estado != "Activo":
        raise EmpleadoInactivoError
    if employee.puesto.estado != "Activo":
        raise PuestoInactivoError
    if not employee.puesto.tiene_funciones_sistema:
        raise PuestoSinFuncionesError
    if employee.id_usuario is not None:
        raise EmpleadoAlreadyLinkedError
    return employee


def _integrity_constraint(error: IntegrityError) -> str | None:
    diagnostics = getattr(error.orig, "diag", None)
    return getattr(diagnostics, "constraint_name", None)


# ==========================================
# OPERACIONES DE USUARIO
# ==========================================
def create_usuario(db: Session, data: UsuarioCreate) -> Usuario:
    _ensure_role_exists(db, data.rol_id)
    _ensure_unique_username(db, data.username)
    modules = _get_modules(db, data.modulo_ids)
    password_hash = get_password_hash(data.password)

    try:
        # El bloqueo evita que dos solicitudes creen cuentas distintas para el
        # mismo empleado antes de que una de ellas confirme la vinculación.
        employee = _lock_employee_for_user_creation(db, data.id_empleado)
        usuario = Usuario(
            nombre=employee.nombres,
            apellido=employee.apellidos,
            username=data.username,
            password_hash=password_hash,
            rol_id=data.rol_id,
            activo=data.activo,
        )
        usuario.modulos = modules
        db.add(usuario)
        db.flush()
        employee.id_usuario = usuario.id
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _integrity_constraint(exc) == "uq_empleados_id_usuario":
            raise EmpleadoAlreadyLinkedError from exc
        if _integrity_constraint(exc) in {"usuarios_username_key", "uq_usuarios_username"}:
            raise UsuarioConflictError from exc
        raise
    except Exception:
        db.rollback()
        raise
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
