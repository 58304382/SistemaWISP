"""Endpoints de solo lectura del Dashboard Gerencial.

Todos los endpoints consultan información existente en PostgreSQL y no
registran movimientos, pagos, estados ni datos auxiliares.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.database import get_db
from app.modules.auth.services.auth import CurrentUser, require_module_access
from app.modules.dashboard.schemas.dashboard import (
    DashboardComercialResponse,
    DashboardFinancieroResponse,
    DashboardOperativoResponse,
    PeriodoDashboard,
    ResumenDashboardResponse,
)
from app.modules.dashboard.services.dashboard import (
    PeriodoDashboardInvalidoError,
    obtener_dashboard_comercial,
    obtener_dashboard_financiero,
    obtener_dashboard_operativo,
    obtener_resumen,
)
from app.modules.usuarios.models.usuario import Usuario


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Código persistido que Usuarios asigna como permiso Dashboard.
DASHBOARD_MODULE_CODE = "dashboard"


def require_dashboard_access(current_user: CurrentUser) -> Usuario:
    """Valida el permiso Dashboard activo y conserva el acceso del Administrador.

    El Administrador mantiene los privilegios administrativos ya definidos para
    el sistema. Cualquier otro usuario debe tener asignado y activo el módulo
    ``dashboard`` desde Usuarios.
    """

    return require_module_access(
        DASHBOARD_MODULE_CODE,
        administrator_bypass=True,
    )(current_user)


DashboardUser = Annotated[Usuario, Depends(require_dashboard_access)]


def _obtener_respuesta(funcion, db, periodo, fecha_referencia, fecha_inicio, fecha_fin):
    """Traduce únicamente los errores de validación del período a HTTP 400."""

    try:
        return funcion(
            db,
            periodo,
            fecha_referencia=fecha_referencia,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
    except PeriodoDashboardInvalidoError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from None


# ==========================================
# RESUMEN CONSOLIDADO
# ==========================================
@router.get("/resumen", response_model=ResumenDashboardResponse)
def get_resumen(
    current_user: DashboardUser,
    periodo: PeriodoDashboard = Query(default="mes"),
    fecha_referencia: date | None = Query(default=None),
    fecha_inicio: date | None = Query(default=None),
    fecha_fin: date | None = Query(default=None),
    db=Depends(get_db),
) -> ResumenDashboardResponse:
    """Devuelve los indicadores consolidados del negocio para el período."""

    return _obtener_respuesta(
        obtener_resumen,
        db,
        periodo,
        fecha_referencia,
        fecha_inicio,
        fecha_fin,
    )


# ==========================================
# FINANZAS
# ==========================================
@router.get("/financiero", response_model=DashboardFinancieroResponse)
def get_dashboard_financiero(
    current_user: DashboardUser,
    periodo: PeriodoDashboard = Query(default="mes"),
    fecha_referencia: date | None = Query(default=None),
    fecha_inicio: date | None = Query(default=None),
    fecha_fin: date | None = Query(default=None),
    db=Depends(get_db),
) -> DashboardFinancieroResponse:
    """Expone ingresos, cobros, cartera, morosidad y sus series financieras."""

    return _obtener_respuesta(
        obtener_dashboard_financiero,
        db,
        periodo,
        fecha_referencia,
        fecha_inicio,
        fecha_fin,
    )


# ==========================================
# COMERCIAL
# ==========================================
@router.get("/comercial", response_model=DashboardComercialResponse)
def get_dashboard_comercial(
    current_user: DashboardUser,
    periodo: PeriodoDashboard = Query(default="mes"),
    fecha_referencia: date | None = Query(default=None),
    fecha_inicio: date | None = Query(default=None),
    fecha_fin: date | None = Query(default=None),
    db=Depends(get_db),
) -> DashboardComercialResponse:
    """Expone clientes, servicios asignados y series comerciales."""

    return _obtener_respuesta(
        obtener_dashboard_comercial,
        db,
        periodo,
        fecha_referencia,
        fecha_inicio,
        fecha_fin,
    )


# ==========================================
# OPERACIÓN
# ==========================================
@router.get("/operativo", response_model=DashboardOperativoResponse)
def get_dashboard_operativo(
    current_user: DashboardUser,
    periodo: PeriodoDashboard = Query(default="mes"),
    fecha_referencia: date | None = Query(default=None),
    fecha_inicio: date | None = Query(default=None),
    fecha_fin: date | None = Query(default=None),
    db=Depends(get_db),
) -> DashboardOperativoResponse:
    """Expone conteos por estado y series operativas de los módulos."""

    return _obtener_respuesta(
        obtener_dashboard_operativo,
        db,
        periodo,
        fecha_referencia,
        fecha_inicio,
        fecha_fin,
    )
