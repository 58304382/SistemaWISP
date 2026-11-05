"""CRUD y consultas del catálogo de tipos de trabajo."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.ordenes_trabajo.models.tipo_trabajo import TipoTrabajo
from app.modules.ordenes_trabajo.models.orden_trabajo import OrdenTrabajo
from app.modules.ordenes_trabajo.schemas.tipo_trabajo import (
    TipoTrabajoCreate,
    TipoTrabajoUpdate,
)


class TipoTrabajoNotFoundError(Exception):
    """El tipo de trabajo solicitado no existe."""


class TipoTrabajoDuplicateError(Exception):
    """El nombre ya está registrado en el catálogo."""


class TipoTrabajoEnUsoError(Exception):
    """El cambio afectaría órdenes existentes o trabajos aún pendientes."""


def _validar_referencias(db: Session, tipo: TipoTrabajo, values) -> None:
    """Conserva nombres históricos y evita desactivar tipos con órdenes abiertas."""
    referencias = select(OrdenTrabajo.id_orden).where(OrdenTrabajo.id_tipo_trabajo == tipo.id_tipo_trabajo)
    if values.get("nombre", tipo.nombre) != tipo.nombre and db.scalar(referencias.limit(1)) is not None:
        raise TipoTrabajoEnUsoError("No se puede renombrar un tipo utilizado por órdenes de trabajo")
    if values.get("estado") == "Inactivo" and tipo.estado != "Inactivo" and db.scalar(
        referencias.where(OrdenTrabajo.estado != "Completada").limit(1)
    ) is not None:
        raise TipoTrabajoEnUsoError("No se puede desactivar: existen órdenes pendientes o en proceso")


def _nombre_normalizado(value: str) -> str:
    return value.casefold().strip()


def list_tipos_trabajo(db: Session, *, solo_activos: bool = False) -> list[TipoTrabajo]:
    """Lista el catálogo completo o únicamente las opciones activas."""

    query = select(TipoTrabajo)
    if solo_activos:
        query = query.where(TipoTrabajo.estado == "Activo")
    return list(
        db.scalars(query.order_by(TipoTrabajo.nombre, TipoTrabajo.id_tipo_trabajo)).all()
    )


def get_tipo_trabajo(db: Session, id_tipo_trabajo: int) -> TipoTrabajo | None:
    return db.get(TipoTrabajo, id_tipo_trabajo)


def _validar_nombre_unico(db: Session, nombre: str, excluir: int | None = None) -> None:
    """Evita duplicados; PostgreSQL no aplica una restricción sobre esta columna."""

    nombre_normalizado = _nombre_normalizado(nombre)
    query = select(func.lower(func.trim(TipoTrabajo.nombre))).where(
        func.lower(func.trim(TipoTrabajo.nombre)) == nombre_normalizado
    )
    if excluir is not None:
        query = query.where(TipoTrabajo.id_tipo_trabajo != excluir)
    if db.scalar(query) is not None:
        raise TipoTrabajoDuplicateError


def create_tipo_trabajo(db: Session, data: TipoTrabajoCreate) -> TipoTrabajo:
    _validar_nombre_unico(db, data.nombre)
    tipo = TipoTrabajo(
        nombre=data.nombre.strip(),
        descripcion=data.descripcion,
        estado=data.estado,
    )
    db.add(tipo)
    db.commit()
    return get_tipo_trabajo(db, tipo.id_tipo_trabajo)  # type: ignore[return-value]


def update_tipo_trabajo(
    db: Session,
    tipo: TipoTrabajo,
    data: TipoTrabajoUpdate,
) -> TipoTrabajo:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    nombre = values.get("nombre")
    if nombre is not None:
        _validar_nombre_unico(db, nombre, excluir=tipo.id_tipo_trabajo)
    _validar_referencias(db, tipo, values)
    for campo in ("nombre", "descripcion", "estado"):
        if campo in values:
            setattr(tipo, campo, values[campo])
    db.commit()
    return get_tipo_trabajo(db, tipo.id_tipo_trabajo)  # type: ignore[return-value]


def delete_tipo_trabajo(db: Session, tipo: TipoTrabajo) -> TipoTrabajo:
    """Baja lógica: conserva el registro físico y evita romper referencias."""

    # El DELETE legado sigue siendo baja lógica y usa las mismas protecciones.
    return update_tipo_trabajo(db, tipo, TipoTrabajoUpdate(estado="Inactivo"))
