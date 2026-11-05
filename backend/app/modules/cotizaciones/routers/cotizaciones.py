"""Endpoints protegidos de Cotizaciones y Proformas."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from app.core.database import get_db
from app.modules.usuarios.models.usuario import Usuario
from app.modules.cotizaciones.schemas.cotizacion import (
    ConfiguracionDocumentoCreate,
    ConfiguracionDocumentoResponse,
    CotizacionDirectaCreate,
    CotizacionEvaluacionCreate,
    CotizacionOrdenEvaluacionCreate,
    CotizacionResponse,
    CotizacionUpdate,
    EstadoCotizacion,
    OrdenEvaluacionPendienteResponse,
    ProformaResponse,
    TrabajoAdicionalCreate,
)
from app.modules.cotizaciones.schemas.reporte import (
    PeriodoReporte,
    ReporteCotizacionesResponse,
)
from app.modules.auth.services.auth import (
    ActiveSystemEmployee,
    Administrator,
    require_module_access,
)
from app.modules.cotizaciones.services.cotizaciones import (
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
    EvaluacionOrdenNotFoundError,
    EvaluacionOrdenYaCotizadaError,
    MaterialEvaluacionInvalidoError,
    ProformaConflictError,
    TrabajoAdicionalEstadoError,
    TrabajoAdicionalNoAutorizadoError,
    aceptar_cotizacion,
    create_cotizacion_directa,
    create_cotizacion_evaluacion,
    create_cotizacion_orden_evaluacion,
    delete_cotizacion,
    generar_cotizacion_evaluacion,
    generar_proforma,
    get_cotizacion,
    get_proforma,
    get_proforma_por_cotizacion,
    list_cotizaciones,
    list_ordenes_evaluaciones_pendientes,
    rechazar_cotizacion,
    registrar_trabajo_adicional,
    update_cotizacion,
)
from app.modules.cotizaciones.services.reportes import generar_reporte_cotizaciones
from app.modules.cotizaciones.services.configuracion_documentos import (
    ConfiguracionDocumentoConflictError,
    ConfiguracionDocumentoNotFoundError,
    get_active_configuration,
    get_latest_configuration,
    publish_configuration,
    save_configuration,
)
from app.services.image_uploads import (
    ImagePathError,
    ImageStorageError,
    ImageTooLargeError,
    InvalidImageError,
    read_image,
)


router = APIRouter(prefix="/api/cotizaciones", tags=["cotizaciones"])
proformas_router = APIRouter(prefix="/api/proformas", tags=["proformas"])

# El permiso se resuelve desde el usuario recargado por el JWT. No se confia en
# roles, autores o habilitaciones enviados por el cliente Angular.
CotizacionesUser = Annotated[Usuario, Depends(require_module_access("cotizaciones"))]


def _configuration_image_error(error: Exception) -> HTTPException:
    """Traduce validaciones del logo sin exponer detalles del almacenamiento."""

    if isinstance(error, ImageTooLargeError):
        return HTTPException(status_code=413, detail="El logotipo supera el límite de 5 MB")
    if isinstance(error, InvalidImageError):
        return HTTPException(
            status_code=400,
            detail="El logotipo debe ser una imagen JPEG, PNG o WEBP válida",
        )
    return HTTPException(status_code=500, detail="No se pudo almacenar el logotipo")


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
    if isinstance(error, EvaluacionOrdenNotFoundError):
        return HTTPException(
            status_code=404, detail="Evaluacion de orden no encontrada"
        )
    if isinstance(error, EvaluacionOrdenYaCotizadaError):
        return HTTPException(
            status_code=409,
            detail="La evaluacion de la orden ya tiene una cotizacion",
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
    if isinstance(error, TrabajoAdicionalNoAutorizadoError):
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La orden está asignada a otro técnico",
        )
    if isinstance(error, TrabajoAdicionalEstadoError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "La cotización o la orden no permiten registrar trabajo adicional "
                "en su estado actual"
            ),
        )
    raise error


DOMAIN_ERRORS = (
    ClienteNotFoundError,
    ClienteInactivoError,
    EvaluacionNotFoundError,
    EvaluacionConflictError,
    EvaluacionNoFinalizadaError,
    EvaluacionOrdenNotFoundError,
    EvaluacionOrdenYaCotizadaError,
    MaterialEvaluacionInvalidoError,
    CotizacionNotFoundError,
    EstadoCotizacionError,
    DetalleCotizacionError,
    CotizacionConflictError,
    EliminacionCotizacionError,
    ProformaConflictError,
    TrabajoAdicionalNoAutorizadoError,
    TrabajoAdicionalEstadoError,
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


@router.get("/pendientes-ordenes", response_model=list[OrdenEvaluacionPendienteResponse])
def get_pendientes_ordenes(
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> list[OrdenEvaluacionPendienteResponse]:
    """Evaluaciones de órdenes pendientes de cotizar (sin cotización vinculada)."""

    return list_ordenes_evaluaciones_pendientes(db)


@router.get("/reporte", response_model=ReporteCotizacionesResponse)
def get_reporte_cotizaciones(
    administrator: Administrator,
    periodo: PeriodoReporte = Query(...),
    fecha: date = Query(...),
    db=Depends(get_db),
) -> ReporteCotizacionesResponse:
    """Genera la vista administrativa sin crear archivos ni modificar datos."""

    nombre = f"{administrator.nombre} {administrator.apellido}".strip()
    usuario = f"{nombre} ({administrator.username})"
    return generar_reporte_cotizaciones(db, periodo, fecha, usuario)


@router.get(
    "/configuracion-documentos/activa",
    response_model=ConfiguracionDocumentoResponse,
)
def get_active_document_configuration(
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> ConfiguracionDocumentoResponse:
    """Entrega únicamente la versión publicada a usuarios de Cotizaciones."""

    configuration = get_active_configuration(db)
    if configuration is None:
        raise HTTPException(status_code=404, detail="No hay una configuración publicada")
    return configuration


@router.get(
    "/configuracion-documentos/ultima",
    response_model=ConfiguracionDocumentoResponse,
)
def get_latest_document_configuration(
    administrator: Administrator,
    db=Depends(get_db),
) -> ConfiguracionDocumentoResponse:
    configuration = get_latest_configuration(db)
    if configuration is None:
        raise HTTPException(status_code=404, detail="No hay configuraciones guardadas")
    return configuration


@router.post(
    "/configuracion-documentos",
    response_model=ConfiguracionDocumentoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_document_configuration(
    data: Annotated[ConfiguracionDocumentoCreate, Depends(ConfiguracionDocumentoCreate.as_form)],
    administrator: Administrator,
    logo: UploadFile | None = File(None),
    db=Depends(get_db),
) -> ConfiguracionDocumentoResponse:
    """Guarda una versión en borrador; solo el rol Administrador puede modificarla."""

    try:
        image_content = None if logo is None else await read_image(logo)
        return save_configuration(db, data, image_content)
    except ConfiguracionDocumentoConflictError:
        raise HTTPException(status_code=409, detail="No se pudo crear la nueva versión") from None
    except (ImageTooLargeError, InvalidImageError, ImageStorageError, ImagePathError) as error:
        raise _configuration_image_error(error) from None


@router.post(
    "/configuracion-documentos/{id_configuracion}/publicar",
    response_model=ConfiguracionDocumentoResponse,
)
def publish_document_configuration(
    id_configuracion: int,
    administrator: Administrator,
    db=Depends(get_db),
) -> ConfiguracionDocumentoResponse:
    """Activa una sola versión mediante una transacción serializada en PostgreSQL."""

    try:
        return publish_configuration(db, id_configuracion)
    except ConfiguracionDocumentoNotFoundError:
        raise HTTPException(status_code=404, detail="Configuración no encontrada") from None
    except ConfiguracionDocumentoConflictError:
        raise HTTPException(status_code=409, detail="No se pudo publicar la configuración") from None


@router.post(
    "/desde-orden-evaluacion",
    response_model=CotizacionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_cotizacion_orden_evaluacion_route(
    data: CotizacionOrdenEvaluacionCreate,
    current_user: CotizacionesUser,
    db=Depends(get_db),
) -> CotizacionResponse:
    """Crea en EN PROCESO la cotización precargada desde la evaluación de orden."""

    try:
        return create_cotizacion_orden_evaluacion(db, data, current_user.id)
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


@router.post("/{id_cotizacion}/trabajo-adicional", response_model=CotizacionResponse)
def registrar_trabajo_adicional_route(
    id_cotizacion: int,
    data: TrabajoAdicionalCreate,
    current_employee: ActiveSystemEmployee,
    db=Depends(get_db),
) -> CotizacionResponse:
    """El técnico asignado agrega trabajo adicional reutilizando la cotización.

    La cotización vuelve a EN PROCESO sin perder los detalles previos; el
    administrador fija los precios y la regenera (EN PROCESO → GENERADA →
    ACEPTADA/RECHAZADA). Se exige identidad laboral del técnico, no permiso del
    módulo Cotizaciones."""

    try:
        return registrar_trabajo_adicional(db, id_cotizacion, data, current_employee)
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
