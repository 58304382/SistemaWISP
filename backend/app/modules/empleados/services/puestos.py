"""Administración de puestos con protección de asignaciones y accesos existentes."""

import unicodedata

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.empleados.models.empleado import Empleado
from app.modules.empleados.models.puesto_empleado import PuestoEmpleado
from app.modules.empleados.schemas.puesto import PuestoWrite, PuestoUpdate


class PuestoError(Exception):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def _normalizar(nombre: str) -> str:
    """Replica la identidad laboral Técnico sin depender de un ID fijo."""
    return "".join(c for c in unicodedata.normalize("NFD", nombre) if not unicodedata.combining(c)).casefold().strip()


def listar_puestos(db: Session):
    return db.scalars(select(PuestoEmpleado).order_by(PuestoEmpleado.nombre)).all()


def guardar_puesto(db: Session, data: PuestoWrite | PuestoUpdate, id_puesto: int | None = None):
    """Solo permite cambios que no invaliden técnicos, empleados activos o cuentas."""
    try:
        puesto = None if id_puesto is None else db.scalar(
            select(PuestoEmpleado).where(PuestoEmpleado.id_puesto == id_puesto).with_for_update()
        )
        if id_puesto is not None and puesto is None:
            raise PuestoError("Puesto no encontrado", 404)
        previos = {} if puesto is None else {c: getattr(puesto, c, None) for c in ("nombre", "descripcion", "estado", "tiene_funciones_sistema")}
        data = PuestoWrite.model_validate({**previos, **data.model_dump(exclude_unset=True)})
        # La comparación normalizada también evita crear un segundo puesto Tecnico.
        existentes = db.scalars(select(PuestoEmpleado)).all()
        if any(p.id_puesto != id_puesto and _normalizar(p.nombre) == _normalizar(data.nombre) for p in existentes):
            raise PuestoError("El nombre del puesto ya está registrado")
        if puesto is not None:
            tecnico = _normalizar(puesto.nombre) == "tecnico"
            if tecnico and (data.nombre != puesto.nombre or data.estado != puesto.estado or data.tiene_funciones_sistema != puesto.tiene_funciones_sistema):
                raise PuestoError("El nombre, estado y clasificación del puesto Técnico están protegidos")
            empleados = select(Empleado.id_empleado).where(Empleado.id_puesto == id_puesto)
            if data.nombre != puesto.nombre and db.scalar(empleados.limit(1)) is not None:
                raise PuestoError("No se puede renombrar un puesto con empleados asignados")
            if data.estado == "Inactivo" and puesto.estado != "Inactivo" and db.scalar(
                empleados.where(or_(Empleado.estado == "Activo", Empleado.id_usuario.is_not(None))).limit(1)
            ) is not None:
                raise PuestoError("No se puede desactivar un puesto con empleados activos o cuentas vinculadas")
            if not data.tiene_funciones_sistema and puesto.tiene_funciones_sistema and db.scalar(
                empleados.where(Empleado.id_usuario.is_not(None)).limit(1)
            ) is not None:
                raise PuestoError("No se pueden retirar las funciones del sistema: existen cuentas vinculadas")
        else:
            if _normalizar(data.nombre) == "tecnico" and (data.estado != "Activo" or not data.tiene_funciones_sistema):
                raise PuestoError("El puesto Técnico debe estar activo y tener funciones del sistema")
            puesto = PuestoEmpleado()
            db.add(puesto)
        puesto.nombre = data.nombre
        puesto.descripcion = (data.descripcion or "").strip() or None
        puesto.estado = data.estado
        puesto.tiene_funciones_sistema = data.tiene_funciones_sistema
        db.commit()
        db.refresh(puesto)
        return puesto
    except IntegrityError as error:
        db.rollback()
        raise PuestoError("El puesto tiene datos duplicados o referencias incompatibles") from error
    except Exception:
        db.rollback()
        raise
