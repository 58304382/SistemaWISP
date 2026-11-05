"""Reglas de negocio de las asignaciones de planes de Internet."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.modules.clientes.models.cliente import Cliente
from app.modules.planes.models.plan import Plan
from app.modules.servicios.models.asignacion_plan import ServicioAsignacionPlan
from app.modules.servicios.schemas.asignacion_plan import (
    AsignacionPlanCreate,
    AsignacionPlanUpdate,
    EstadoAsignacion,
)


class ClienteAsignacionNoEncontradoError(Exception):
    """El cliente seleccionado no existe."""


class PlanAsignacionNoDisponibleError(Exception):
    """El plan seleccionado no existe o no está activo."""


class AsignacionActivaDuplicadaError(Exception):
    """El cliente ya posee una asignación activa del servicio de Internet."""


class AsignacionInvalidaError(Exception):
    """PostgreSQL rechazó una relación o dato de la asignación."""


class AsignacionConRegistrosRelacionadosError(Exception):
    """La asignación conserva relaciones que impiden eliminar su historial."""


def list_asignaciones(
    db: Session, estado: EstadoAsignacion | None = None
) -> list[ServicioAsignacionPlan]:
    """Lista asignaciones con cliente y plan para evitar consultas por cada fila."""

    query = (
        select(ServicioAsignacionPlan)
        .options(
            joinedload(ServicioAsignacionPlan.cliente),
            joinedload(ServicioAsignacionPlan.plan),
        )
        .order_by(ServicioAsignacionPlan.id_asignacion.desc())
    )
    if estado is not None:
        query = query.where(ServicioAsignacionPlan.estado == estado)
    return list(db.scalars(query).all())


def get_asignacion(db: Session, asignacion_id: int) -> ServicioAsignacionPlan | None:
    return db.scalar(
        select(ServicioAsignacionPlan)
        .options(
            joinedload(ServicioAsignacionPlan.cliente),
            joinedload(ServicioAsignacionPlan.plan),
        )
        .where(ServicioAsignacionPlan.id_asignacion == asignacion_id)
    )


def list_clientes_catalogo(db: Session) -> list[Cliente]:
    """Expone clientes reales sin exigir adicionalmente el permiso Clientes."""

    return list(db.scalars(select(Cliente).order_by(Cliente.nombres, Cliente.apellidos)).all())


def list_planes_activos_catalogo(db: Session) -> list[Plan]:
    """Limita el selector a planes activos y conserva su precio oficial."""

    return list(
        db.scalars(
            select(Plan).where(Plan.estado == "Activo").order_by(Plan.nombre)
        ).all()
    )


def _get_cliente(db: Session, cliente_id: int) -> Cliente:
    # Limita el bloqueo a clientes: la carga eager de municipio agrega un LEFT JOIN
    # que PostgreSQL no permite bloquear con un FOR UPDATE sin tabla objetivo.
    cliente = db.scalar(
        select(Cliente)
        .where(Cliente.id_cliente == cliente_id)
        .with_for_update(of=Cliente)
    )
    if cliente is None:
        raise ClienteAsignacionNoEncontradoError
    return cliente


def _get_plan_activo(db: Session, plan_id: int) -> Plan:
    plan = db.scalar(
        select(Plan)
        .where(Plan.id == plan_id, Plan.estado == "Activo")
        .with_for_update()
    )
    if plan is None:
        raise PlanAsignacionNoDisponibleError
    return plan


def _ensure_no_active_duplicate(
    db: Session, cliente_id: int, asignacion_id: int | None = None
) -> None:
    """Evita dos servicios de Internet activos para el mismo cliente."""

    query = select(ServicioAsignacionPlan.id_asignacion).where(
        ServicioAsignacionPlan.id_cliente == cliente_id,
        ServicioAsignacionPlan.estado == "Activo",
    )
    if asignacion_id is not None:
        query = query.where(ServicioAsignacionPlan.id_asignacion != asignacion_id)
    if db.scalar(query) is not None:
        raise AsignacionActivaDuplicadaError


def _commit(db: Session, asignacion: ServicioAsignacionPlan) -> ServicioAsignacionPlan:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AsignacionInvalidaError from exc
    db.refresh(asignacion)
    return asignacion


def create_asignacion(
    db: Session, data: AsignacionPlanCreate
) -> ServicioAsignacionPlan:
    """Crea una asignación tomando el costo mensual del plan activo."""

    cliente = _get_cliente(db, data.id_cliente)
    plan = _get_plan_activo(db, data.id_plan)
    if data.estado == "Activo":
        _ensure_no_active_duplicate(db, data.id_cliente)

    asignacion = ServicioAsignacionPlan(
        id_cliente=data.id_cliente,
        id_plan=plan.id,
        costo_mensual=plan.precio_mensual,
        fecha_inicio=data.fecha_inicio,
        estado=data.estado,
        cliente=cliente,
        plan=plan,
    )
    db.add(asignacion)
    return _commit(db, asignacion)


def update_asignacion(
    db: Session,
    asignacion: ServicioAsignacionPlan,
    data: AsignacionPlanUpdate,
) -> ServicioAsignacionPlan:
    """Actualiza campos editables y recalcula el costo cuando cambia el plan."""

    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    cliente_id = values.get("id_cliente", asignacion.id_cliente)
    estado = values.get("estado", asignacion.estado)

    cliente = None
    if "id_cliente" in values or estado == "Activo":
        cliente = _get_cliente(db, cliente_id)
    if "id_plan" in values:
        plan = _get_plan_activo(db, values["id_plan"])
        asignacion.id_plan = plan.id
        asignacion.costo_mensual = plan.precio_mensual
        asignacion.plan = plan
    if estado == "Activo":
        _ensure_no_active_duplicate(db, cliente_id, asignacion.id_asignacion)

    for field in ("id_cliente", "fecha_inicio", "estado"):
        if field in values:
            setattr(asignacion, field, values[field])
    if "id_cliente" in values and cliente is not None:
        asignacion.cliente = cliente
    asignacion.fecha_actualizacion = func.now()
    return _commit(db, asignacion)


def update_dia_vencimiento(
    db: Session,
    asignacion: ServicioAsignacionPlan,
    dia_vencimiento: int,
) -> ServicioAsignacionPlan:
    """Actualiza solo el vencimiento sin alterar el precio ni el servicio contratado."""

    asignacion.dia_vencimiento = dia_vencimiento
    asignacion.fecha_actualizacion = func.now()
    return _commit(db, asignacion)


def delete_asignacion(db: Session, asignacion: ServicioAsignacionPlan) -> None:
    """Elimina solo la asignación si PostgreSQL no detecta relaciones existentes."""

    db.delete(asignacion)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AsignacionConRegistrosRelacionadosError from exc
