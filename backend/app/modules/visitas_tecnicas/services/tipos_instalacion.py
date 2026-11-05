"""Consultas y CRUD administrativo del catalogo de tipos de instalacion."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.instalaciones.models.instalacion import Instalacion
from app.modules.visitas_tecnicas.models.tipo_instalacion import TipoInstalacion
from app.modules.visitas_tecnicas.models.visita_tecnica import VisitaTecnica
from app.modules.visitas_tecnicas.schemas.tipo_instalacion import (
    TipoInstalacionCreate,
    TipoInstalacionUpdate,
)


ESTADOS_OPERATIVOS = ("Programada", "En Proceso")


class TipoInstalacionNotFoundError(Exception):
    """El tipo de instalacion solicitado no existe."""


class TipoInstalacionDuplicateError(Exception):
    """El nombre ya existe en el catalogo, sin distinguir mayusculas ni espacios."""


class TipoInstalacionEnUsoError(Exception):
    """Existen visitas o instalaciones en proceso que dependen del tipo."""


def list_tipos_instalacion(
    db: Session, *, incluir_inactivos: bool = False
) -> list[TipoInstalacion]:
    """Lista el catalogo completo para administracion o solo las opciones activas."""

    query = select(TipoInstalacion)
    if not incluir_inactivos:
        query = query.where(TipoInstalacion.estado == "Activo")
    return list(
        db.scalars(
            query.order_by(
                TipoInstalacion.nombre,
                TipoInstalacion.id_tipo_instalacion,
            )
        ).all()
    )


def list_tipos_instalacion_activos(db: Session) -> list[TipoInstalacion]:
    """Conserva el contrato usado por Visitas e Instalaciones."""

    return list_tipos_instalacion(db)


def get_tipo_instalacion(
    db: Session, id_tipo_instalacion: int
) -> TipoInstalacion | None:
    return db.get(TipoInstalacion, id_tipo_instalacion)


def _validar_nombre_unico(
    db: Session, nombre: str, excluir: int | None = None
) -> None:
    """Evita duplicados por diferencias de mayusculas o espacios exteriores."""

    normalizado = nombre.strip().lower()
    query = select(TipoInstalacion.id_tipo_instalacion).where(
        func.lower(func.trim(TipoInstalacion.nombre)) == normalizado
    )
    if excluir is not None:
        query = query.where(TipoInstalacion.id_tipo_instalacion != excluir)
    if db.scalar(query) is not None:
        raise TipoInstalacionDuplicateError


def _validar_inactivacion(db: Session, id_tipo_instalacion: int) -> None:
    """Impide retirar un tipo que todavia sostiene trabajos en curso.

    Las visitas e instalaciones completadas conservan la referencia historica y
    no impiden inactivar el catalogo; solo se bloquean los estados operativos.
    """

    visitas_activas = db.scalar(
        select(func.count())
        .select_from(VisitaTecnica)
        .where(
            VisitaTecnica.id_tipo_instalacion == id_tipo_instalacion,
            VisitaTecnica.estado.in_(ESTADOS_OPERATIVOS),
        )
    )
    instalaciones_activas = db.scalar(
        select(func.count())
        .select_from(Instalacion)
        .join(VisitaTecnica, VisitaTecnica.id_visita == Instalacion.id_visita)
        .where(
            VisitaTecnica.id_tipo_instalacion == id_tipo_instalacion,
            Instalacion.estado.in_(ESTADOS_OPERATIVOS),
        )
    )
    if (visitas_activas or 0) + (instalaciones_activas or 0) > 0:
        raise TipoInstalacionEnUsoError


def create_tipo_instalacion(
    db: Session, data: TipoInstalacionCreate
) -> TipoInstalacion:
    """Registra un tipo nuevo sin aceptar identificadores del cliente."""

    _validar_nombre_unico(db, data.nombre)
    tipo = TipoInstalacion(
        nombre=data.nombre.strip(),
        descripcion=data.descripcion,
        estado=data.estado,
    )
    db.add(tipo)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TipoInstalacionDuplicateError from exc
    db.refresh(tipo)
    return tipo


def update_tipo_instalacion(
    db: Session,
    tipo: TipoInstalacion,
    data: TipoInstalacionUpdate,
) -> TipoInstalacion:
    """Actualiza datos o estado; inactivar exige que no haya trabajos en curso."""

    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    nombre = values.get("nombre")
    if nombre is not None:
        _validar_nombre_unico(db, nombre, excluir=tipo.id_tipo_instalacion)
        # El nombre también aparece en historial y reportes por la misma FK.
        if nombre != tipo.nombre and db.scalar(
            select(VisitaTecnica.id_visita).where(
                VisitaTecnica.id_tipo_instalacion == tipo.id_tipo_instalacion
            ).limit(1)
        ) is not None:
            raise TipoInstalacionEnUsoError("No se puede renombrar un tipo utilizado por visitas técnicas")
    if values.get("estado") == "Inactivo" and tipo.estado != "Inactivo":
        _validar_inactivacion(db, tipo.id_tipo_instalacion)

    for campo in ("nombre", "descripcion", "estado"):
        if campo in values:
            setattr(tipo, campo, values[campo])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TipoInstalacionDuplicateError from exc
    db.refresh(tipo)
    return tipo
