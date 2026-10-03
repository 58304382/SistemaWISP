"""Endpoints protegidos de Cotizaciones y Proformas."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.database import get_db
from app.models.usuario import Usuario
from app.schemas.cotizacion import (
    CotizacionDirectaCreate,
    CotizacionEvaluacionCreate,
    CotizacionResponse,
    CotizacionUpdate,
    EstadoCotizacion,
    ProformaResponse,
)
from app.services.auth import require_module_access
from app.services.cotizaciones import (
    ClienteInactivoError,
    ClienteNotFoundError,
    CotizacionConflictError,
    CotizacionNotFoundError,
    DetalleCotizacionError,
    EliminacionCotizacionError,
    EstadoCotizacionError,
    EvaluacionConflictError,
    EvaluacionNoFinalizadaError,
    EvaluacionNotFoundError,
    MaterialEvaluacionInvalidoError,
    ProformaConflictError,
    aceptar_cotizacion,
    create_cotizacion_directa,
    create_cotizacion_evaluacion,
    delete_cotizacion,
    generar_cotizacion_evaluacion,
    generar_proforma,
    get_cotizacion,
    get_proforma,
    get_proforma_por_cotizacion,
    list_cotizaciones,
    rechazar_cotizacion,
    update_cotizacion,
)


router = APIRouter(prefix="/api/cotizaciones", tags=["cotizaciones"])
proformas_router = APIRouter(prefix="/api/proformas", tags=["proformas"])

# El permiso se resuelve desde el usuario recargado por el JWT. No se confia en
# roles, autores o habilitaciones enviados por el cliente Angular.
CotizacionesUser = Annotated[Usuario, Depends(require_module_access("cotizaciones"))]


def _domain_http_error(error: Exception) -> HTTPException:
    if isinstance(error, ClienteNotFoundError):
        return HTTPException(status_code=404, detail="Cliente no encontrado")
    if isinstance(error, ClienteInactivoError):
        return HTTPException(status_code=400, detail="El cliente debe estar activo")
    if isinstance(error, EvaluacionNotFoundError):
        return HTTPException(status_code=404, detail="Evaluacion tecnica no encontrada")
    if isinstance(error, EvaluacionConflictError):
        return HTTPException(
            status_code=409, detail="La evaluacion ya tiene una cotizacion"
        )
    if isinstance(error, EvaluacionNoFinalizadaError):
        return HTTPException(
            status_code=409,
            detail="La evaluacion tecnica debe estar Completada",
        )
    if isinstance(error, MaterialEvaluacionInvalidoError):
        return HTTPException(
            status_code=400,
            detail="Un material de la evaluacion excede la unidad permitida",
        )
    if isinstance(error, CotizacionNotFoundError):
        return HTTPException(status_code=404, detail="Cotizacion no encontrada")
    if isinstance(error, EstadoCotizacionError):
        return HTTPException(
            status_code=409,
            detail="El estado actual de la cotizacion no permite esta operacion",
        )
    if isinstance(error, DetalleCotizacionError):
        return HTTPException(
            status_code=400,
            detail=(
                "La cotizacion requiere detalles validos y todos los precios "
                "unitarios informados"
            ),
        )
    if isinstance(error, CotizacionConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, EliminacionCotizacionError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, ProformaConflictError):
        return HTTPException(
            status_code=409, detail="La cotizacion ya tiene una proforma"
        )
    raise error


DOMAIN_ERRORS = (
    ClienteNotFoundError,
    ClienteInactivoError,
    EvaluacionNotFoundError,
    EvaluacionConflictError,
    EvaluacionNoFinalizadaError,
    MaterialEvaluacionInvalidoError,
    CotizacionNotFoundError,
    EstadoCotizacionError,
    DetalleCotizacionError,
    CotizacionConflictError,
    EliminacionCotizacionError,
    ProformaConflictError,
)


@router.get("", response_model=list[CotizacionResponse])
def get_cotizaciones(
    current_user: CotizacionesUser,
    estado: EstadoCotizacion | None = Query(default=None),
    db=Depends(get_db),
) -> list[CotizacionResponse]:
    return list_cotizaciones(db, estado)


@router.post(
    "",
    response_model=CotizacionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_cotizacion_directa_route(
    data: CotizacionDirectaCreate,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    try:
        return create_cotizacion_directa(db, data, current_user.id)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.post(
    "/desde-evaluacion",
    response_model=CotizacionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_cotizacion_evaluacion_route(
    data: CotizacionEvaluacionCreate,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    try:
        return create_cotizacion_evaluacion(db, data, current_user.id)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.get("/{id_cotizacion}", response_model=CotizacionResponse)
def get_cotizacion_by_id(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    cotizacion = get_cotizacion(db, id_cotizacion)
    if cotizacion is None:
        raise HTTPException(status_code=404, detail="Cotizacion no encontrada")
    return cotizacion


@router.patch("/{id_cotizacion}", response_model=CotizacionResponse)
def update_cotizacion_route(
    id_cotizacion: int,
    data: CotizacionUpdate,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    try:
        return update_cotizacion(db, id_cotizacion, data)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.post("/{id_cotizacion}/generar", response_model=CotizacionResponse)
def generar_cotizacion_evaluacion_route(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    """Ejecuta explicitamente EN PROCESO a GENERADA con el permiso del modulo."""

    try:
        return generar_cotizacion_evaluacion(db, id_cotizacion)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.post("/{id_cotizacion}/aceptar", response_model=CotizacionResponse)
def aceptar_cotizacion_route(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    try:
        return aceptar_cotizacion(db, id_cotizacion)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.post("/{id_cotizacion}/rechazar", response_model=CotizacionResponse)
def rechazar_cotizacion_route(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    try:
        return rechazar_cotizacion(db, id_cotizacion)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.delete("/{id_cotizacion}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cotizacion_route(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> Response:
    try:
        delete_cotizacion(db, id_cotizacion)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{id_cotizacion}/proforma",
    response_model=ProformaResponse,
    status_code=status.HTTP_201_CREATED,
)
def generar_proforma_route(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> ProformaResponse:
    try:
        return generar_proforma(db, id_cotizacion)
    except DOMAIN_ERRORS as error:
        raise _domain_http_error(error) from None


@router.get("/{id_cotizacion}/proforma", response_model=ProformaResponse)
def get_proforma_by_cotizacion(
    id_cotizacion: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> ProformaResponse:
    proforma = get_proforma_por_cotizacion(db, id_cotizacion)
    if proforma is None:
        raise HTTPException(status_code=404, detail="Proforma no encontrada")
    return proforma


@proformas_router.get("/{id_proforma}", response_model=ProformaResponse)
def get_proforma_by_id(
    id_proforma: int,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> ProformaResponse:
    proforma = get_proforma(db, id_proforma)
    if proforma is None:
        raise HTTPException(status_code=404, detail="Proforma no encontrada")
    return proforma
