"""Reglas de negocio, validaciones y consultas del modulo de clientes."""

# ==========================================
# IMPORTS
# ==========================================
from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models.cliente import Cliente
from app.models.ubicacion import Departamento, Municipio
from app.schemas.cliente import ClienteCreate, ClienteUpdate


# ==========================================
# ERRORES DE DOMINIO
# ==========================================
class MunicipioInactivoError(Exception):
    """Indica que el municipio o su departamento no puede recibir clientes."""


class DepartamentoInactivoError(Exception):
    """Indica que el departamento solicitado no esta activo o no existe."""


# ==========================================
# CATALOGOS Y CONSULTAS
# ==========================================
def list_departamentos(db: Session) -> list[Departamento]:
    """Devuelve unicamente departamentos activos."""

    return list(
        db.scalars(
            select(Departamento)
            .where(Departamento.estado == "Activo")
            .order_by(Departamento.nombre)
        ).all()
    )


def list_municipios(db: Session, id_departamento: int) -> list[Municipio]:
    """Devuelve municipios activos de un departamento activo."""

    departamento_activo = db.scalar(
        select(Departamento.id_departamento).where(
            Departamento.id_departamento == id_departamento,
            Departamento.estado == "Activo",
        )
    )
    if departamento_activo is None:
        raise DepartamentoInactivoError

    return list(
        db.scalars(
            select(Municipio)
            .where(
                Municipio.id_departamento == id_departamento,
                Municipio.estado == "Activo",
            )
            .order_by(Municipio.nombre)
        ).all()
    )


def _client_query():
    """Construye la consulta con municipio para respuestas completas."""

    return select(Cliente).options(joinedload(Cliente.municipio))


def list_clientes(db: Session) -> list[Cliente]:
    """Devuelve clientes ordenados por identificador, incluyendo su municipio."""

    return list(db.scalars(_client_query().order_by(Cliente.id_cliente)).unique().all())


def get_cliente(db: Session, id_cliente: int) -> Cliente | None:
    """Busca un cliente por identificador con su municipio cargado."""

    return db.scalar(_client_query().where(Cliente.id_cliente == id_cliente))


# ==========================================
# VALIDACION DE UBICACION
# ==========================================
def _get_active_municipio(db: Session, id_municipio: int) -> Municipio:
    """Valida que municipio y departamento sigan activos."""

    municipio = db.scalar(
        select(Municipio)
        .join(Departamento)
        .where(
            Municipio.id_municipio == id_municipio,
            Municipio.estado == "Activo",
            Departamento.estado == "Activo",
        )
    )
    if municipio is None:
        raise MunicipioInactivoError
    return municipio


# ==========================================
# OPERACIONES DE CLIENTE
# ==========================================
def create_cliente(db: Session, data: ClienteCreate) -> Cliente:
    """Valida la ubicacion y registra un cliente."""

    _get_active_municipio(db, data.id_municipio)
    values = data.model_dump()
    # Todo registro nuevo inicia Activo; el cambio de estado pertenece a la edicion.
    values["estado"] = "Activo"
    cliente = Cliente(**values)
    db.add(cliente)
    db.commit()
    return get_cliente(db, cliente.id_cliente)  # type: ignore[return-value]


def update_cliente(db: Session, cliente: Cliente, data: ClienteUpdate) -> Cliente:
    """Actualiza campos permitidos y valida el municipio asociado."""

    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    id_municipio = values.get("id_municipio", cliente.id_municipio)
    if id_municipio is None:
        raise MunicipioInactivoError
    _get_active_municipio(db, id_municipio)

    for field in (
        "id_municipio",
        "nombres",
        "apellidos",
        "dpi",
        "telefono",
        "correo",
        "direccion",
        "referencia",
        "estado",
    ):
        if field in values:
            setattr(cliente, field, values[field])
    

    db.commit()
    return get_cliente(db, cliente.id_cliente)  # type: ignore[return-value]


def delete_cliente(db: Session, cliente: Cliente) -> Cliente:
    """Realiza baja logica, conservando el registro fisico."""

    cliente.estado = "Inactivo"
    db.commit()
    return get_cliente(db, cliente.id_cliente)  # type: ignore[return-value]
