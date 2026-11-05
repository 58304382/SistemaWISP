"""Schemas públicos para planes de servicio."""

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


TipoPlan = Literal["ESTANDAR", "PERSONALIZADO"]
EstadoPlan = Literal["Activo", "Inactivo"]


class PlanCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    velocidad: str = Field(min_length=1, max_length=30)
    precio_mensual: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    tipo_plan: TipoPlan
    estado: EstadoPlan = "Activo"
    descripcion: str | None = Field(default=None, max_length=2000)


class PlanUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    velocidad: str | None = Field(default=None, min_length=1, max_length=30)
    precio_mensual: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    estado: EstadoPlan | None = None
    descripcion: str | None = Field(default=None, max_length=2000)


class PlanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    velocidad: str
    precio_mensual: Decimal
    tipo_plan: TipoPlan
    estado: EstadoPlan
    descripcion: str | None
    created_at: datetime | None
    updated_at: datetime | None
