"""Contratos HTTP para asignar planes de Internet a clientes."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


EstadoAsignacion = Literal["Activo", "Inactivo"]


class AsignacionPlanCreate(BaseModel):
    """Datos editables; el costo se obtiene exclusivamente desde el plan."""

    model_config = ConfigDict(extra="forbid")

    id_cliente: int = Field(gt=0)
    id_plan: int = Field(gt=0)
    fecha_inicio: date
    estado: EstadoAsignacion = "Activo"


class AsignacionPlanUpdate(BaseModel):
    """Actualización parcial sin permitir borrar campos obligatorios."""

    model_config = ConfigDict(extra="forbid")

    id_cliente: int | None = Field(default=None, gt=0)
    id_plan: int | None = Field(default=None, gt=0)
    fecha_inicio: date | None = None
    estado: EstadoAsignacion | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> Self:
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} no puede ser nulo")
        return self


class DiaVencimientoAsignacionUpdate(BaseModel):
    """Configura el día mensual de vencimiento desde Cobros de Internet."""

    model_config = ConfigDict(extra="forbid")

    dia_vencimiento: int = Field(ge=1, le=31)


class ClienteAsignacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_cliente: int
    nombres: str
    apellidos: str
    estado: str


class PlanAsignacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    velocidad: str
    precio_mensual: Decimal
    estado: str


class AsignacionPlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_asignacion: int
    id_cliente: int
    id_plan: int
    costo_mensual: Decimal
    fecha_inicio: date
    dia_vencimiento: int | None = Field(default=None, ge=1, le=31)
    estado: EstadoAsignacion
    fecha_creacion: datetime
    fecha_actualizacion: datetime | None
    cliente: ClienteAsignacionResponse
    plan: PlanAsignacionResponse


class ClienteAsignacionCatalogoResponse(ClienteAsignacionResponse):
    """Cliente existente disponible para el selector de Servicios."""


class PlanAsignacionCatalogoResponse(PlanAsignacionResponse):
    """Plan activo disponible para una asignación nueva o editada."""
