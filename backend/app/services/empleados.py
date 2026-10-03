"""Reglas de negocio, consultas y manejo local de fotos de empleados."""

from collections.abc import Mapping
from io import BytesIO
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.empleado import Empleado
from app.models.puesto_empleado import PuestoEmpleado
from app.models.ubicacion import Departamento, Municipio
from app.schemas.empleado import EmpleadoCreate, EmpleadoUpdate


MAX_PHOTO_BYTES = 5 * 1024 * 1024
BACKEND_ROOT = Path(__file__).resolve().parents[2]
PHOTO_DIRECTORY = BACKEND_ROOT / "uploads" / "empleados"
PHOTO_DIRECTORY_RELATIVE = "uploads/empleados"


class EmpleadoConflictError(Exception):
    """Indica conflicto con codigo o documento."""


class PuestoInactivoError(Exception):
    """Indica que el puesto no existe o no esta activo."""


class MunicipioInactivoError(Exception):
    """Indica que el municipio no existe o no esta activo."""


class PhotoTooLargeError(Exception):
    """Indica que la foto supera el limite permitido."""


class InvalidPhotoError(Exception):
    """Indica que el contenido no es una imagen permitida."""


class PhotoStorageError(Exception):
    """Indica que no se pudo guardar la foto."""


class PhotoPathError(Exception):
    """Indica que una ruta persistida no pertenece al directorio seguro."""


def list_puestos_activos(db: Session) -> list[PuestoEmpleado]:
    return list(
        db.scalars(
            select(PuestoEmpleado)
            .where(PuestoEmpleado.estado == "Activo")
            .order_by(PuestoEmpleado.nombre)
        ).all()
    )


def _employee_query():
    return (
        select(Empleado)
        .options(joinedload(Empleado.puesto))
        .options(joinedload(Empleado.municipio).joinedload(Municipio.departamento))
    )


def _photo_url(relative_path: str | None) -> str | None:
    if relative_path is None:
        return None
    return f"/{relative_path.replace('\\', '/').lstrip('/')}"


def _employee_response(employee: Empleado) -> dict[str, Any]:
    return {
        "id_empleado": employee.id_empleado,
        "codigo": employee.codigo,
        "nombres": employee.nombres,
        "apellidos": employee.apellidos,
        "tipo_documento": employee.tipo_documento,
        "numero_documento": employee.numero_documento,
        "telefono_principal": employee.telefono_principal,
        "telefono_alternativo": employee.telefono_alternativo,
        "correo": employee.correo,
        "direccion": employee.direccion,
        "fecha_ingreso": employee.fecha_ingreso,
        "estado": employee.estado,
        "observaciones": employee.observaciones,
        "foto_perfil": _photo_url(employee.foto_perfil),
        "id_puesto": employee.id_puesto,
        "nombre_puesto": employee.puesto.nombre,
        "id_municipio": employee.id_municipio,
        "nombre_municipio": employee.municipio.nombre,
        "id_departamento": employee.municipio.id_departamento,
        "nombre_departamento": employee.municipio.departamento.nombre,
    }


def list_empleados(db: Session) -> list[dict[str, Any]]:
    employees = db.scalars(_employee_query().order_by(Empleado.id_empleado)).unique().all()
    return [_employee_response(employee) for employee in employees]


def get_empleado(db: Session, id_empleado: int) -> dict[str, Any] | None:
    employee = db.scalar(_employee_query().where(Empleado.id_empleado == id_empleado))
    return None if employee is None else _employee_response(employee)


def get_empleado_model(db: Session, id_empleado: int) -> Empleado | None:
    return db.scalar(_employee_query().where(Empleado.id_empleado == id_empleado))


def list_departamentos(db: Session) -> list[Departamento]:
    return list(
        db.scalars(
            select(Departamento)
            .where(Departamento.estado == "Activo")
            .order_by(Departamento.nombre)
        ).all()
    )


def list_municipios(db: Session, id_departamento: int) -> list[Municipio]:
    departamento = db.scalar(
        select(Departamento.id_departamento).where(
            Departamento.id_departamento == id_departamento,
            Departamento.estado == "Activo",
        )
    )
    if departamento is None:
        raise MunicipioInactivoError

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


def _validate_puesto(db: Session, id_puesto: int) -> PuestoEmpleado:
    puesto = db.scalar(
        select(PuestoEmpleado).where(
            PuestoEmpleado.id_puesto == id_puesto,
            PuestoEmpleado.estado == "Activo",
        )
    )
    if puesto is None:
        raise PuestoInactivoError
    return puesto


def _validate_municipio(db: Session, id_municipio: int) -> Municipio:
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


def _normalize_photo(content: bytes) -> bytes:
    if len(content) > MAX_PHOTO_BYTES:
        raise PhotoTooLargeError
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise InvalidPhotoError
            image.verify()

        with Image.open(BytesIO(content)) as image:
            image.load()
            output = BytesIO()
            mode = "RGBA" if "A" in image.getbands() else "RGB"
            image.convert(mode).save(output, format="WEBP", quality=85, method=6)
            return output.getvalue()
    except (InvalidPhotoError, PhotoTooLargeError):
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
        raise InvalidPhotoError from None


def _safe_photo_path(relative_path: str) -> Path:
    candidate = (BACKEND_ROOT / relative_path).resolve()
    photo_directory = PHOTO_DIRECTORY.resolve()
    if candidate.parent != photo_directory:
        raise PhotoPathError
    return candidate


def _save_photo(photo_content: bytes, id_empleado: int) -> tuple[str, Path]:
    PHOTO_DIRECTORY.mkdir(parents=True, exist_ok=True)
    filename = f"empleado_{id_empleado}_{uuid4().hex}.webp"
    destination = PHOTO_DIRECTORY / filename
    temporary = PHOTO_DIRECTORY / f".{filename}.tmp"
    try:
        temporary.write_bytes(photo_content)
        os.replace(temporary, destination)
    except OSError as exc:
        if temporary.exists():
            temporary.unlink(missing_ok=True)
        raise PhotoStorageError from exc
    return f"{PHOTO_DIRECTORY_RELATIVE}/{filename}", destination


def _remove_photo_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def create_empleado(
    db: Session,
    data: EmpleadoCreate,
    photo_content: bytes | None = None,
) -> dict[str, Any]:
    _validate_puesto(db, data.id_puesto)
    _validate_municipio(db, data.id_municipio)
    normalized_photo = None if photo_content is None else _normalize_photo(photo_content)

    employee = Empleado(
        id_puesto=data.id_puesto,
        id_municipio=data.id_municipio,
        codigo=f"__pending__{uuid4().hex}",
        nombres=data.nombres,
        apellidos=data.apellidos,
        tipo_documento=data.tipo_documento,
        numero_documento=data.numero_documento,
        telefono_principal=data.telefono_principal,
        telefono_alternativo=data.telefono_alternativo,
        correo=str(data.correo) if data.correo is not None else None,
        direccion=data.direccion,
        fecha_ingreso=data.fecha_ingreso,
        estado="Activo",
        observaciones=data.observaciones,
    )
    db.add(employee)
    saved_photo: Path | None = None
    try:
        db.flush()
        employee.codigo = f"EMP-{employee.id_empleado:04d}"
        if normalized_photo is not None:
            relative_path, saved_photo = _save_photo(normalized_photo, employee.id_empleado)
            employee.foto_perfil = relative_path
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if saved_photo is not None:
            _remove_photo_file(saved_photo)
        raise EmpleadoConflictError from exc
    except Exception:
        db.rollback()
        if saved_photo is not None:
            _remove_photo_file(saved_photo)
        raise

    response = get_empleado(db, employee.id_empleado)
    if response is None:
        raise RuntimeError("El empleado creado no pudo recuperarse")
    return response


def update_empleado(
    db: Session,
    employee: Empleado,
    data: EmpleadoUpdate,
) -> dict[str, Any]:
    values: Mapping[str, Any] = data.model_dump(exclude_unset=True)
    if "id_puesto" in values:
        _validate_puesto(db, values["id_puesto"])
    if "id_municipio" in values:
        _validate_municipio(db, values["id_municipio"])
    if "correo" in values and values["correo"] is not None:
        values["correo"] = str(values["correo"])

    for field in (
        "id_puesto",
        "id_municipio",
        "nombres",
        "apellidos",
        "tipo_documento",
        "numero_documento",
        "telefono_principal",
        "telefono_alternativo",
        "correo",
        "direccion",
        "fecha_ingreso",
        "estado",
        "observaciones",
    ):
        if field in values:
            setattr(employee, field, values[field])

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise EmpleadoConflictError from exc

    response = get_empleado(db, employee.id_empleado)
    if response is None:
        raise RuntimeError("El empleado actualizado no pudo recuperarse")
    return response


def delete_empleado(db: Session, employee: Empleado) -> dict[str, Any]:
    employee.estado = "Inactivo"
    db.commit()
    response = get_empleado(db, employee.id_empleado)
    if response is None:
        raise RuntimeError("El empleado desactivado no pudo recuperarse")
    return response


def replace_empleado_photo(
    db: Session,
    employee: Empleado,
    photo_content: bytes,
) -> dict[str, Any]:
    normalized_photo = _normalize_photo(photo_content)
    old_photo = None if employee.foto_perfil is None else _safe_photo_path(employee.foto_perfil)
    relative_path, saved_photo = _save_photo(normalized_photo, employee.id_empleado)
    employee.foto_perfil = relative_path
    try:
        db.commit()
    except Exception:
        db.rollback()
        _remove_photo_file(saved_photo)
        raise

    if old_photo is not None and old_photo != saved_photo:
        _remove_photo_file(old_photo)
    response = get_empleado(db, employee.id_empleado)
    if response is None:
        raise RuntimeError("El empleado actualizado no pudo recuperarse")
    return response


def remove_empleado_photo(db: Session, employee: Empleado) -> dict[str, Any]:
    old_photo = None if employee.foto_perfil is None else _safe_photo_path(employee.foto_perfil)
    backup: bytes | None = None
    if old_photo is not None and old_photo.exists():
        try:
            backup = old_photo.read_bytes()
            old_photo.unlink()
        except OSError as exc:
            raise PhotoStorageError from exc

    employee.foto_perfil = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        if old_photo is not None and backup is not None:
            try:
                old_photo.write_bytes(backup)
            except OSError:
                pass
        raise

    response = get_empleado(db, employee.id_empleado)
    if response is None:
        raise RuntimeError("El empleado actualizado no pudo recuperarse")
    return response
