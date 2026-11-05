"""Consultas, validaciones y reglas de negocio de proveedores."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.modules.mapas.models.ubicacion import Departamento, Municipio
from app.modules.proveedores.models.proveedor import Proveedor
from app.modules.proveedores.schemas.proveedor import (
    ProveedorCreate,
    ProveedorUpdate,
)


class MunicipioProveedorError(Exception):
    """Indica que el municipio o su departamento no existen o están inactivos."""


class ProveedorEnUsoError(Exception):
    """Indica que una relación existente impide eliminar el proveedor."""


class ProveedorConflictError(Exception):
    """Indica que PostgreSQL rechazó los datos del proveedor."""


def _proveedor_query():
    """Construye consultas con el municipio precargado para las respuestas."""

    return select(Proveedor).options(joinedload(Proveedor.municipio))


def list_proveedores(db: Session) -> list[Proveedor]:
    """Lista todos los proveedores por su identificador real."""

    return list(db.scalars(_proveedor_query().order_by(Proveedor.id_proveedor)).all())


def get_proveedor(db: Session, id_proveedor: int) -> Proveedor | None:
    """Consulta un proveedor por el ID generado en PostgreSQL."""

    return db.scalar(_proveedor_query().where(Proveedor.id_proveedor == id_proveedor))


def _validar_municipio(db: Session, id_municipio: int) -> None:
    """Exige un municipio activo perteneciente a un departamento activo."""

    municipio = db.scalar(
        select(Municipio.id_municipio)
        .join(Departamento)
        .where(
            Municipio.id_municipio == id_municipio,
            Municipio.estado == "Activo",
            Departamento.estado == "Activo",
        )
    )
    if municipio is None:
        raise MunicipioProveedorError


def create_proveedor(db: Session, data: ProveedorCreate) -> Proveedor:
    """Valida la ubicación y registra un proveedor sin asignar manualmente su ID."""

    _validar_municipio(db, data.id_municipio)
    proveedor = Proveedor(**data.model_dump())
    db.add(proveedor)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ProveedorConflictError from exc
    return get_proveedor(db, proveedor.id_proveedor)  # type: ignore[return-value]


def update_proveedor(
    db: Session, proveedor: Proveedor, data: ProveedorUpdate
) -> Proveedor:
    """Actualiza únicamente los campos públicos después de validar el municipio."""

    _validar_municipio(db, data.id_municipio)
    for field, value in data.model_dump().items():
        setattr(proveedor, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ProveedorConflictError from exc
    return get_proveedor(db, proveedor.id_proveedor)  # type: ignore[return-value]


def set_proveedor_estado(
    db: Session, proveedor: Proveedor, estado: str
) -> Proveedor:
    """Activa o inactiva al proveedor sin alterar sus demás datos."""

    proveedor.estado = estado
    db.commit()
    return get_proveedor(db, proveedor.id_proveedor)  # type: ignore[return-value]


def delete_proveedor(db: Session, proveedor: Proveedor) -> None:
    """Elimina solo proveedores sin relaciones protegidas por PostgreSQL."""

    db.delete(proveedor)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ProveedorEnUsoError from exc
