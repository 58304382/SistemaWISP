"""Reglas de negocio y consultas del módulo de planes."""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.plan import Plan
from app.schemas.plan import PlanCreate, PlanUpdate, TipoPlan


class PlanConflictError(Exception):
    pass


class PlanInUseError(Exception):
    pass


def list_planes(db: Session, tipo_plan: TipoPlan | None = None) -> list[Plan]:
    query = select(Plan).order_by(Plan.id)
    if tipo_plan is not None:
        query = query.where(Plan.tipo_plan == tipo_plan)
    return list(db.scalars(query).all())


def get_plan(db: Session, plan_id: int) -> Plan | None:
    return db.scalar(select(Plan).where(Plan.id == plan_id))


def _ensure_unique_name(db: Session, nombre: str, plan_id: int | None = None) -> None:
    query = select(Plan.id).where(Plan.nombre == nombre)
    if plan_id is not None:
        query = query.where(Plan.id != plan_id)
    if db.scalar(query) is not None:
        raise PlanConflictError


def create_plan(db: Session, data: PlanCreate) -> Plan:
    _ensure_unique_name(db, data.nombre)
    plan = Plan(
        nombre=data.nombre,
        velocidad=data.velocidad,
        precio_mensual=data.precio_mensual,
        tipo_plan=data.tipo_plan,
        estado=data.estado,
        descripcion=data.descripcion,
    )
    db.add(plan)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise PlanConflictError from exc
    db.refresh(plan)
    return plan


def update_plan(db: Session, plan: Plan, data: PlanUpdate) -> Plan:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    nombre = values.get("nombre", plan.nombre)
    _ensure_unique_name(db, nombre, plan.id)

    for field in ("nombre", "velocidad", "precio_mensual", "estado", "descripcion"):
        if field in values:
            setattr(plan, field, values[field])
    plan.updated_at = func.now()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise PlanConflictError from exc
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: Plan) -> None:
    db.delete(plan)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # A future servicios.plan_id foreign key will reject this delete here.
        raise PlanInUseError from exc
