"""Endpoints protegidos de apertura y movimientos de Caja General."""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.core.database import get_db
from app.modules.auth.services.auth import Administrator, require_module_access
from app.modules.finanzas.schemas.caja import (
    AperturaCajaCreate,
    CategoriaCajaResponse,
    CierreCajaCreate,
    CierreCajaResponse,
    CierreEmpleadoCreate,
    MovimientoCajaDetalleResponse,
    MovimientoManualCajaCreate,
    MovimientosCajaPageResponse,
    SesionCajaActualResponse,
)
from app.modules.finanzas.schemas.cobros import MetodoPagoResponse
from app.modules.finanzas.schemas.caja import CategoriaCajaCreate, CategoriaCajaUpdate
from app.modules.finanzas.services import catalogos as catalogo_financiero
from app.modules.finanzas.schemas.reporte import PeriodoReporte, ReporteCajaResponse
from app.modules.finanzas.services.caja import (
    CategoriaCajaInvalidaError,
    EfectivoCierreDesactualizadoError,
    HistoricosSinClasificarError,
    EntregasPendientesError,
    FondosCajaInsuficientesError,
    MetodoPagoCajaInvalidoError,
    MovimientoCajaDuplicadoError,
    ReferenciaMovimientoRequeridaError,
    ResponsableCierreInvalidoError,
    SesionCajaAbiertaError,
    SesionCajaNoAbiertaError,
    SesionCajaNoEncontradaError,
    SesionesCajaInconsistentesError,
    abrir_caja,
    cerrar_caja,
    get_sesion_actual,
    list_categorias_manuales_activas,
    list_movimientos_caja,
    registrar_movimiento_manual,
)
from app.modules.finanzas.services.cobros import list_metodos_pago_activos
from app.modules.finanzas.services.reportes import generar_reporte_caja
from app.modules.finanzas.models.caja import EntregaCobrador
from app.modules.finanzas.services.entregas import (
    EntregaInvalidaError, registrar_entrega, resumen_sesion, historial_entregas, detalle_entrega,
)
from app.modules.usuarios.models.usuario import Usuario


router = APIRouter(prefix="/api/caja", tags=["caja"])


# Solo administración del catálogo: no concede permisos de operación de Caja.
@router.get("/categorias/todas", response_model=list[CategoriaCajaResponse])
def listar_catalogo_categorias(administrator: Administrator, db=Depends(get_db)):
    return catalogo_financiero.listar_categorias(db)


@router.post("/categorias", response_model=CategoriaCajaResponse, status_code=201)
def crear_categoria_caja(data: CategoriaCajaCreate, administrator: Administrator, db=Depends(get_db)):
    try:
        return catalogo_financiero.guardar_categoria(db, data)
    except catalogo_financiero.CatalogoFinancieroError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None


@router.patch("/categorias/{id_categoria}", response_model=CategoriaCajaResponse)
def editar_categoria_caja(id_categoria: int, data: CategoriaCajaUpdate, administrator: Administrator, db=Depends(get_db)):
    try:
        return catalogo_financiero.guardar_categoria(db, data, id_categoria)
    except catalogo_financiero.CatalogoFinancieroError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None
CajaUser = Annotated[Usuario, Depends(require_module_access("caja"))]


def require_caja_administrator(current_user: CajaUser) -> Usuario:
    """Exige Administrador autorizado y una identidad laboral activa."""

    if current_user.rol.nombre != "Administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere un Administrador autorizado para Caja General",
        )
    empleado = current_user.empleado
    if empleado is None or empleado.estado != "Activo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El Administrador no tiene un empleado activo asociado",
        )
    if (
        empleado.puesto is None
        or empleado.puesto.estado != "Activo"
        or not empleado.puesto.tiene_funciones_sistema
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El puesto del Administrador no permite operar Caja General",
        )
    return current_user


CajaAdministrator = Annotated[Usuario, Depends(require_caja_administrator)]


def _caja_http_error(error: Exception) -> HTTPException:
    if isinstance(error, EntregasPendientesError):
        return HTTPException(status_code=409, detail="Confirme las entregas pendientes de empleados antes de cerrar Caja General.")
    if isinstance(error, HistoricosSinClasificarError):
        return HTTPException(status_code=409, detail="La sesión contiene efectivo histórico sin clasificación. El cierre general está bloqueado; no se modificaron esos pagos.")
    if isinstance(error, SesionCajaNoEncontradaError):
        return HTTPException(status_code=404, detail="Sesion de Caja no encontrada")
    if isinstance(error, ResponsableCierreInvalidoError):
        return HTTPException(
            status_code=403,
            detail="Solo el empleado que abrio la sesion puede cerrar Caja General",
        )
    if isinstance(error, EfectivoCierreDesactualizadoError):
        return HTTPException(
            status_code=409,
            detail="El efectivo cambio; actualice el resumen y confirme nuevamente el cierre",
        )
    if isinstance(error, SesionCajaAbiertaError):
        return HTTPException(status_code=409, detail="Ya existe una sesion de Caja abierta")
    if isinstance(error, SesionCajaNoAbiertaError):
        return HTTPException(status_code=409, detail="No existe una sesion de Caja abierta")
    if isinstance(error, SesionesCajaInconsistentesError):
        return HTTPException(
            status_code=409,
            detail="Existen varias sesiones abiertas; se requiere corregir la integridad",
        )
    if isinstance(error, CategoriaCajaInvalidaError):
        return HTTPException(
            status_code=400,
            detail=(
                "La categoria manual debe estar activa y corresponder a Entrada o Salida"
            ),
        )
    if isinstance(error, MetodoPagoCajaInvalidoError):
        return HTTPException(status_code=400, detail="El metodo de pago debe estar activo")
    if isinstance(error, ReferenciaMovimientoRequeridaError):
        return HTTPException(
            status_code=400,
            detail="Los movimientos no efectivos requieren referencia",
        )
    if isinstance(error, FondosCajaInsuficientesError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "Efectivo insuficiente en Caja General",
                "disponible": str(error.disponible),
                "solicitado": str(error.solicitado),
            },
        )
    if isinstance(error, MovimientoCajaDuplicadoError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "La solicitud repite un movimiento ya confirmado",
                "id_movimiento": error.id_movimiento,
            },
        )
    raise error


CAJA_ERRORS = (
    EntregasPendientesError,
    HistoricosSinClasificarError,
    SesionCajaNoEncontradaError,
    ResponsableCierreInvalidoError,
    EfectivoCierreDesactualizadoError,
    SesionCajaAbiertaError,
    SesionCajaNoAbiertaError,
    SesionesCajaInconsistentesError,
    CategoriaCajaInvalidaError,
    MetodoPagoCajaInvalidoError,
    ReferenciaMovimientoRequeridaError,
    FondosCajaInsuficientesError,
    MovimientoCajaDuplicadoError,
)


@router.post(
    "/apertura",
    response_model=SesionCajaActualResponse,
    status_code=status.HTTP_201_CREATED,
)
def abrir_caja_general(
    data: AperturaCajaCreate,
    current_user: CajaAdministrator,
    db=Depends(get_db),
) -> SesionCajaActualResponse:
    """Abre la Caja unica con la identidad obtenida del JWT."""

    try:
        return abrir_caja(db, data, current_user.empleado.id_empleado)
    except CAJA_ERRORS as error:
        raise _caja_http_error(error) from None


@router.post("/sesiones/{id_sesion}/cierre", response_model=CierreCajaResponse)
def cerrar_caja_general(
    data: CierreCajaCreate,
    current_user: CajaAdministrator,
    id_sesion: int = Path(gt=0),
    db=Depends(get_db),
) -> CierreCajaResponse:
    """Exige JWT y permisos de Caja; el responsable real proviene del usuario autenticado."""

    try:
        return cerrar_caja(db, id_sesion, data, current_user.empleado.id_empleado)
    except CAJA_ERRORS as error:
        raise _caja_http_error(error) from None


@router.get("/sesion-actual", response_model=SesionCajaActualResponse)
def consultar_sesion_actual(
    current_user: CajaAdministrator,
    db=Depends(get_db),
) -> SesionCajaActualResponse:
    """Devuelve la unica sesion abierta y su efectivo fisico disponible."""

    try:
        sesion = get_sesion_actual(db)
    except SesionesCajaInconsistentesError as error:
        raise _caja_http_error(error) from None
    if sesion is None:
        raise HTTPException(status_code=404, detail="No existe una sesion de Caja abierta")
    return sesion


@router.get("/categorias", response_model=list[CategoriaCajaResponse])
def consultar_categorias_manuales(
    tipo: Literal["Ingreso", "Egreso"],
    _current_user: CajaAdministrator,
    db=Depends(get_db),
) -> list[CategoriaCajaResponse]:
    """Expone solo la categoria manual activa compatible con el tipo solicitado."""

    return list_categorias_manuales_activas(db, tipo)


@router.get("/metodos-pago", response_model=list[MetodoPagoResponse])
def consultar_metodos_pago(
    _current_user: CajaAdministrator,
    db=Depends(get_db),
) -> list[MetodoPagoResponse]:
    """Reutiliza los metodos activos bajo la autorizacion administrativa de Caja."""

    return list_metodos_pago_activos(db)


@router.post(
    "/movimientos",
    response_model=MovimientoCajaDetalleResponse,
    status_code=status.HTTP_201_CREATED,
)
def registrar_movimiento(
    data: MovimientoManualCajaCreate,
    current_user: CajaAdministrator,
    db=Depends(get_db),
) -> MovimientoCajaDetalleResponse:
    """Registra un ingreso o egreso manual sin aceptar IDs de responsabilidad."""

    try:
        return registrar_movimiento_manual(db, data, current_user.empleado)
    except CAJA_ERRORS as error:
        raise _caja_http_error(error) from None


@router.get("/movimientos", response_model=MovimientosCajaPageResponse)
def consultar_movimientos(
    current_user: CajaAdministrator,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    id_sesion: int | None = Query(default=None, gt=0),
    tipo: Literal["Ingreso", "Egreso"] | None = Query(default=None),
    id_categoria: int | None = Query(default=None, gt=0),
    id_metodo_pago: int | None = Query(default=None, gt=0),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    db=Depends(get_db),
) -> MovimientosCajaPageResponse:
    """Consulta el historial inmutable con filtros y paginacion."""

    return list_movimientos_caja(
        db,
        page=page,
        page_size=page_size,
        id_sesion=id_sesion,
        tipo=tipo,
        id_categoria=id_categoria,
        id_metodo_pago=id_metodo_pago,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )


@router.get("/sesiones/{id_sesion}/conciliacion")
def consultar_conciliacion(current_user: CajaAdministrator, id_sesion: int = Path(gt=0), db=Depends(get_db)):
    """Resume custodia y cobros de toda la sesión sin clasificar pagos históricos."""
    try:
        return resumen_sesion(db, id_sesion)
    except EntregaInvalidaError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None


@router.post("/entregas", status_code=201)
def confirmar_entrega(data: CierreEmpleadoCreate, current_user: CajaAdministrator, db=Depends(get_db)):
    """Solo el encargado autenticado autoriza gastos y recibe la entrega."""
    try:
        return registrar_entrega(db, data, current_user.empleado.id_empleado)
    except EntregaInvalidaError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None
    except CAJA_ERRORS as error:
        raise _caja_http_error(error) from None


@router.get("/entregas")
def consultar_entregas(current_user: CajaAdministrator, id_sesion: int = Query(gt=0),
                       id_empleado: int | None = Query(default=None, gt=0), db=Depends(get_db)):
    return historial_entregas(db, id_sesion, id_empleado)


@router.get("/entregas/{id_entrega}")
def consultar_entrega(current_user: CajaAdministrator, id_entrega: int = Path(gt=0), db=Depends(get_db)):
    entrega = db.get(EntregaCobrador, id_entrega)
    if entrega is None:
        raise HTTPException(status_code=404, detail="Entrega no encontrada")
    return detalle_entrega(db, entrega)


@router.get("/reporte", response_model=ReporteCajaResponse)
def get_reporte_caja(
    administrator: Administrator,
    periodo: PeriodoReporte = Query(...),
    fecha: date = Query(...),
    db=Depends(get_db),
) -> ReporteCajaResponse:
    """Genera la vista administrativa de movimientos sin modificar la Caja."""

    nombre = f"{administrator.nombre} {administrator.apellido}".strip()
    usuario = f"{nombre} ({administrator.username})"
    return generar_reporte_caja(db, periodo, fecha, usuario)
