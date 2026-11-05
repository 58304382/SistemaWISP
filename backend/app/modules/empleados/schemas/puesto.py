"""Contrato administrativo de puestos; conserva la clasificación laboral real."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, StrictBool, model_validator


class PuestoWrite(BaseModel):
    """No admite IDs ni cambios de permisos de cuentas de usuario."""

    model_config = ConfigDict(extra="forbid")
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    descripcion: str | None = None
    estado: Literal["Activo", "Inactivo"] = "Activo"
    tiene_funciones_sistema: StrictBool = False


class PuestoUpdate(BaseModel):
    """No cambia la clasificación laboral de un puesto por omisión de campos."""

    model_config = ConfigDict(extra="forbid")
    nombre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    descripcion: str | None = None
    estado: Literal["Activo", "Inactivo"] | None = None
    tiene_funciones_sistema: StrictBool | None = None

    @model_validator(mode="after")
    def rechazar_nulos_obligatorios(self):
        if any(c in self.model_fields_set and getattr(self, c) is None for c in ("nombre", "estado", "tiene_funciones_sistema")):
            raise ValueError("Nombre, estado y funciones del sistema no pueden ser nulos")
        return self
