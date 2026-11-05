"""Endpoints protegidos para consultas y confirmacion de pagos."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core.database import get_db
from app.modules.auth.services.auth import (
    ActiveSystemEmployee,
    Administrator,
    CurrentUser,
    get_current_employee,
    require_active_system_employee,
)
from app.modules.clientes.schemas.cliente import ClienteResponse
from app.modules.clientes.services.clientes import list_clientes
from app.modules.finanzas.models.cobros import Cobro, ComprobanteCobro, Pago
from app.modules.empleados.models.empleado import Empleado
from app.modules.finanzas.schemas.comprobante_configuracion import (
    ConfiguracionComprobanteCreate,
    ConfiguracionComprobanteResponse,
)
from app.modules.finanzas.schemas.cobros import (
    CobroSaldoResponse,
    CobrosPageResponse,
    ComprobantesPageResponse,
    ComprobanteTicketResponse,
    CotizacionInstalacionCobroResponse,
    CotizacionOrdenCobroResponse,
    DistribucionPagoCreate,
    GeneracionMensualidadesInternetCreate,
    GeneracionMensualidadesInternetResponse,
    HistorialCobrosPageResponse,
    MetodoPagoResponse,
    OrigenFinanciero,
    PagoConfirmadoResponse,
    PagosAplicadosPageResponse,
    PagosSaldoDisponiblePageResponse,
    RegistroPagoCreate,
    RegistroPendienteCreate,
)
from app.modules.finanzas.schemas.reporte import (
    PeriodoReporte,
    ReporteCobrosResponse,
)
from app.modules.finanzas.schemas.cobros import MetodoPagoCreate, MetodoPagoUpdate
from app.modules.finanzas.services import catalogos as catalogo_financiero
from app.modules.finanzas.services.caja import (
    CategoriaCajaInvalidaError,
    MetodoPagoCajaInvalidoError,
    ReferenciaMovimientoRequeridaError,
    SesionCajaNoAbiertaError,
    SesionesCajaInconsistentesError,
)
from app.modules.finanzas.services.cobros import (
    AplicacionPagoEnConflictoError,
    ClaveIdempotenciaEnConflictoError,
    ClientePagoNoEncontradoError,
    CobroNotFoundError,
    CobrosPagoNoEncontradosError,
    DistribucionPagoIncompatibleError,
    RecepcionEfectivoInvalidaError,
    FuentePagoNoVerificableError,
    MigracionFinancieraPendienteError,
    OrigenPagoNoSoportadoError,
    PagoNoEncontradoError,
    SaldoCobroInconsistenteError,
    SaldoPagoInconsistenteError,
    SaldoPagoInsuficienteError,
    SobrepagoCobroError,
    TipoPagoOrdenInvalidoError,
    distribuir_pago,
    generar_mensualidades_internet,
    get_cobro,
    list_cobros,
    list_historial_cobros,
    list_metodos_pago_activos,
    list_pagos_aplicados,
    list_pagos_con_saldo,
    registrar_pago,
    registrar_obligacion_pendiente,
)
from app.modules.finanzas.services.reportes import generar_reporte_cobros
from app.modules.finanzas.services.comprobante_configuracion import (
    ConfiguracionComprobanteConflictError,
    get_active_configuration as get_active_receipt_configuration,
    get_latest_configuration as get_latest_receipt_configuration,
    save_configuration as save_receipt_configuration,
)
from app.modules.finanzas.services.comprobantes import (
    ComprobanteInconsistenteError,
    ComprobanteNumeracionAgotadaError,
    ComprobantePdfAlmacenamientoError,
    ComprobantePdfNoDisponibleError,
    consultar_ticket_emitido,
    generar_pdf_termico,
    list_comprobantes,
    ruta_pdf_comprobante,
)
from app.modules.finanzas.services.cobros_instalaciones import (
    CotizacionInstalacionInvalidaError,
    CotizacionInstalacionNoEncontradaError,
    InstalacionCobroInconsistenteError,
    listar_cotizaciones_instalacion,
)
from app.modules.finanzas.services.cobros_ordenes import (
    CotizacionOrdenInvalidaError,
    CotizacionOrdenNoEncontradaError,
    MigracionOrdenesTrabajoPendienteError,
    OrdenCobroInconsistenteError,
    listar_cotizaciones_orden,
)
from app.modules.servicios.schemas.asignacion_plan import (
    AsignacionPlanResponse,
    DiaVencimientoAsignacionUpdate,
)
from app.modules.servicios.services.asignaciones_planes import (
    AsignacionInvalidaError,
    get_asignacion,
    list_asignaciones,
    update_dia_vencimiento,
)
from app.modules.usuarios.models.usuario import Usuario


router = APIRouter(prefix="/api/cobros", tags=["cobros"])


# No cambia el GET de métodos activos de Cobros; el CRUD exige Administrador.
@router.get("/metodos-pago/todos", response_model=list[MetodoPagoResponse])
def listar_catalogo_metodos(administrator: Administrator, db=Depends(get_db)):
    return catalogo_financiero.listar_metodos(db)


@router.post("/metodos-pago", response_model=MetodoPagoResponse, status_code=201)
def crear_metodo_pago(data: MetodoPagoCreate, administrator: Administrator, db=Depends(get_db)):
    try:
        return catalogo_financiero.guardar_metodo(db, data)
    except catalogo_financiero.CatalogoFinancieroError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None


@router.patch("/metodos-pago/{id_metodo}", response_model=MetodoPagoResponse)
def editar_metodo_pago(id_metodo: int, data: MetodoPagoUpdate, administrator: Administrator, db=Depends(get_db)):
    try:
        return catalogo_financiero.guardar_metodo(db, data, id_metodo)
    except catalogo_financiero.CatalogoFinancieroError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from None

# Códigos persistidos de las categorías hijas del módulo Pagos.
PAYMENT_CATEGORY_MODULES = {
    "INTERNET": "pagos_internet",
    "INSTALACIONES": "pagos_instalaciones",
    "ORDENES_TRABAJO": "pagos_ordenes_trabajo",
}
PAYMENT_ORIGINS = tuple(PAYMENT_CATEGORY_MODULES)
INTERNET_DUE_DATES_MODULE = "administrar_vencimientos_internet"
INTERNET_MONTHLY_GENERATION_MODULE = "generar_mensualidades_internet"


def _tiene_modulo_activo(current_user: Usuario, codigo: str) -> bool:
    return any(modulo.codigo == codigo and modulo.activo for modulo in current_user.modulos)


def _requerir_modulo_cobros(current_user: Usuario, *codigos: str) -> None:
    """Autoriza al Administrador o cualquiera de los permisos operativos indicados."""

    if current_user.rol.nombre == "Administrador":
        return
    if not any(_tiene_modulo_activo(current_user, codigo) for codigo in codigos):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para esta operación de Cobros",
        )


def _empleado_para_confirmar_pago(current_user: Usuario):
    """Usa la identidad laboral activa; el Administrador sin empleado usa la Caja."""

    if current_user.rol.nombre == "Administrador" and current_user.empleado is None:
        return None
    return require_active_system_employee(get_current_employee(current_user))


def _origenes_pago_autorizados(current_user: Usuario) -> tuple[str, ...]:
    """Obtiene las categorias autorizadas por los permisos activos del usuario."""

    if current_user.rol.nombre == "Administrador":
        return PAYMENT_ORIGINS
    autorizados = tuple(
        origen
        for origen, codigo in PAYMENT_CATEGORY_MODULES.items()
        if _tiene_modulo_activo(current_user, codigo)
    )
    if not autorizados:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para ninguna categoria de Pagos",
        )
    return autorizados


def _requerir_origen_pago(current_user: Usuario, origen: str) -> None:
    """Valida el permiso hijo correspondiente al origen financiero solicitado."""

    if origen not in PAYMENT_CATEGORY_MODULES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La categoria de Pagos no esta autorizada",
        )
    if origen not in _origenes_pago_autorizados(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos para esta categoria de Pagos",
        )


def require_cobros_access(current_user: CurrentUser) -> Usuario:
    """Exige al menos una categoria activa de Pagos o el rol Administrador."""

    _origenes_pago_autorizados(current_user)
    return current_user


CobrosUser = Annotated[Usuario, Depends(require_cobros_access)]


def _saldo_http_error(error: SaldoCobroInconsistenteError) -> HTTPException:
    """Reporta el sobrepago sin devolver un saldo negativo como dato normal."""

    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "mensaje": "Los pagos aplicados superan el monto de la obligacion",
            "id_cobro": error.id_cobro,
            "monto": str(error.monto),
            "total_pagado": str(error.total_pagado),
        },
    )


def _pago_http_error(error: Exception) -> HTTPException:
    if isinstance(error, RecepcionEfectivoInvalidaError):
        return HTTPException(status_code=error.status_code, detail=str(error))
    """Traduce reglas transaccionales sin exponer errores internos de PostgreSQL."""

    if isinstance(error, MigracionFinancieraPendienteError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La migracion financiera 008 aun no esta aplicada y verificada",
        )
    if isinstance(error, OrigenPagoNoSoportadoError):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"El origen {error.origen_financiero} no posee una entidad fuente "
                "verificable"
            ),
        )
    if isinstance(error, ClientePagoNoEncontradoError):
        return HTTPException(status_code=404, detail="Cliente no encontrado")
    if isinstance(error, PagoNoEncontradoError):
        return HTTPException(status_code=404, detail="Pago no encontrado")
    if isinstance(error, FuentePagoNoVerificableError):
        return HTTPException(
            status_code=409,
            detail="El cliente no posee una instalacion que respalde el pago",
        )
    if isinstance(error, CobrosPagoNoEncontradosError):
        return HTTPException(
            status_code=404,
            detail={"mensaje": "Cobros no encontrados", "ids_cobro": error.ids_cobro},
        )
    if isinstance(error, DistribucionPagoIncompatibleError):
        return HTTPException(
            status_code=409,
            detail="Todos los cobros deben pertenecer al cliente y origen del pago",
        )
    if isinstance(error, SaldoCobroInconsistenteError):
        return _saldo_http_error(error)
    if isinstance(error, SobrepagoCobroError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "La aplicacion supera el saldo de la obligacion",
                "id_cobro": error.id_cobro,
                "saldo": str(error.saldo),
                "solicitado": str(error.solicitado),
            },
        )
    if isinstance(error, TipoPagoOrdenInvalidoError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "El tipo de pago no corresponde al saldo de la obligacion",
                "tipo_pago": error.tipo_pago,
                "saldo": str(error.saldo),
                "monto": str(error.monto),
            },
        )
    if isinstance(error, ClaveIdempotenciaEnConflictoError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "La clave de idempotencia pertenece a otro pago",
                "id_pago": error.id_pago,
            },
        )
    if isinstance(error, AplicacionPagoEnConflictoError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "El pago ya posee otra aplicacion para el cobro",
                "id_cobro": error.id_cobro,
            },
        )
    if isinstance(error, SaldoPagoInsuficienteError):
        return HTTPException(
            status_code=409,
            detail={
                "mensaje": "El pago no posee saldo suficiente sin distribuir",
                "disponible": str(error.disponible),
                "solicitado": str(error.solicitado),
            },
        )
    if isinstance(error, SaldoPagoInconsistenteError):
        return HTTPException(
            status_code=409,
            detail="Las aplicaciones persistidas superan el monto total del pago",
        )
    if isinstance(error, SesionCajaNoAbiertaError):
        return HTTPException(status_code=409, detail="No existe una sesion de Caja abierta")
    if isinstance(error, SesionesCajaInconsistentesError):
        return HTTPException(status_code=409, detail="Existen varias sesiones de Caja abiertas")
    if isinstance(error, CategoriaCajaInvalidaError):
        return HTTPException(
            status_code=409,
            detail="No existe una categoria automatica activa para el origen",
        )
    if isinstance(error, MetodoPagoCajaInvalidoError):
        return HTTPException(status_code=400, detail="El metodo de pago debe estar activo")
    if isinstance(error, ReferenciaMovimientoRequeridaError):
        return HTTPException(
            status_code=400,
            detail="Los pagos no efectivos requieren referencia",
        )
    if isinstance(error, ComprobantePdfNoDisponibleError):
        return HTTPException(
            status_code=404,
            detail="El PDF del comprobante no esta disponible",
        )
    if isinstance(error, ComprobantePdfAlmacenamientoError):
        return HTTPException(
            status_code=500,
            detail="No fue posible generar el PDF del comprobante",
        )
    if isinstance(error, ComprobanteNumeracionAgotadaError):
        return HTTPException(
            status_code=409,
            detail="La numeracion consecutiva de comprobantes se agoto",
        )
    if isinstance(error, ComprobanteInconsistenteError):
        return HTTPException(
            status_code=409,
            detail="Los importes aplicados no coinciden con el pago confirmado",
        )
    if isinstance(error, MigracionOrdenesTrabajoPendienteError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La integracion de Ordenes de Trabajo requiere aplicar la migracion 009",
        )
    if isinstance(error, CotizacionOrdenNoEncontradaError):
        return HTTPException(
            status_code=404,
            detail="Cotizacion de orden no encontrada para el cliente",
        )
    if isinstance(error, CotizacionOrdenInvalidaError):
        return HTTPException(
            status_code=409,
            detail="La cotizacion de la orden no posee un documento comercial valido",
        )
    if isinstance(error, OrdenCobroInconsistenteError):
        return HTTPException(
            status_code=409,
            detail="La obligacion de la orden no coincide con su cotizacion aceptada",
        )
    if isinstance(error, CotizacionInstalacionNoEncontradaError):
        return HTTPException(
            status_code=404,
            detail="Cotizacion de instalacion no encontrada para el cliente",
        )
    if isinstance(error, CotizacionInstalacionInvalidaError):
        return HTTPException(
            status_code=409,
            detail="La cotizacion de instalacion no posee un documento comercial valido",
        )
    if isinstance(error, InstalacionCobroInconsistenteError):
        return HTTPException(
            status_code=409,
            detail="La obligacion de la instalacion no coincide con su cotizacion aceptada",
        )
    raise error


PAGO_ERRORS = (
    RecepcionEfectivoInvalidaError,
    MigracionFinancieraPendienteError,
    OrigenPagoNoSoportadoError,
    ClientePagoNoEncontradoError,
    PagoNoEncontradoError,
    FuentePagoNoVerificableError,
    CobrosPagoNoEncontradosError,
    DistribucionPagoIncompatibleError,
    SaldoCobroInconsistenteError,
    SobrepagoCobroError,
    TipoPagoOrdenInvalidoError,
    ClaveIdempotenciaEnConflictoError,
    AplicacionPagoEnConflictoError,
    SaldoPagoInsuficienteError,
    SaldoPagoInconsistenteError,
    SesionCajaNoAbiertaError,
    SesionesCajaInconsistentesError,
    CategoriaCajaInvalidaError,
    MetodoPagoCajaInvalidoError,
    ReferenciaMovimientoRequeridaError,
    ComprobantePdfNoDisponibleError,
    ComprobantePdfAlmacenamientoError,
    ComprobanteNumeracionAgotadaError,
    ComprobanteInconsistenteError,
    MigracionOrdenesTrabajoPendienteError,
    CotizacionOrdenNoEncontradaError,
    CotizacionOrdenInvalidaError,
    OrdenCobroInconsistenteError,
    CotizacionInstalacionNoEncontradaError,
    CotizacionInstalacionInvalidaError,
    InstalacionCobroInconsistenteError,
)


@router.get("/metodos-pago", response_model=list[MetodoPagoResponse])
def get_metodos_pago_activos(
    current_user: CurrentUser,
    db=Depends(get_db),
) -> list[MetodoPagoResponse]:
    """Obtiene el catalogo activo sin exponer obligaciones ni saldos."""

    _origenes_pago_autorizados(current_user)
    return list_metodos_pago_activos(db)


@router.get("/clientes", response_model=list[ClienteResponse])
def get_clientes_para_cobros(
    current_user: CurrentUser,
    db=Depends(get_db),
) -> list[ClienteResponse]:
    """Expone clientes activos a Cobros reutilizando el modulo Clientes.

    Una categoria hija de ``pagos`` basta para consultar el cliente que se va a
    cobrar, sin conceder por ello acceso administrativo al modulo Clientes.
    """

    _origenes_pago_autorizados(current_user)
    return [cliente for cliente in list_clientes(db) if cliente.estado == "Activo"]


@router.get(
    "/internet/servicios",
    response_model=list[AsignacionPlanResponse],
)
def get_servicios_internet(
    current_user: CurrentUser,
    db=Depends(get_db),
) -> list[AsignacionPlanResponse]:
    """Lista los servicios configurables por cobradores autorizados de Internet."""

    _requerir_modulo_cobros(
        current_user,
        "pagos_internet",
        INTERNET_DUE_DATES_MODULE,
        INTERNET_MONTHLY_GENERATION_MODULE,
    )
    return list_asignaciones(db)


@router.get("/empleados-receptores")
def get_empleados_receptores(current_user: CurrentUser, db=Depends(get_db)):
    """Reutiliza empleados activos sin filtrar puestos ni exponer sus datos privados."""
    _origenes_pago_autorizados(current_user)
    empleados = db.scalars(select(Empleado).where(Empleado.estado == "Activo")
                           .order_by(Empleado.nombres, Empleado.apellidos)).all()
    return [{
        "id_empleado": e.id_empleado,
        "codigo": e.codigo,
        "nombres": e.nombres,
        "apellidos": e.apellidos,
    } for e in empleados]


@router.patch(
    "/internet/servicios/{id_asignacion}/dia-vencimiento",
    response_model=AsignacionPlanResponse,
)
def actualizar_dia_vencimiento_internet(
    id_asignacion: int,
    data: DiaVencimientoAsignacionUpdate,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> AsignacionPlanResponse:
    """Configura el día sin generar mensualidades, pagos ni movimientos de Caja."""

    _requerir_modulo_cobros(current_user, INTERNET_DUE_DATES_MODULE)
    asignacion = get_asignacion(db, id_asignacion)
    if asignacion is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asignación de Internet no encontrada",
        )
    try:
        return update_dia_vencimiento(db, asignacion, data.dia_vencimiento)
    except AsignacionInvalidaError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fue posible actualizar el día de vencimiento",
        ) from None


@router.post(
    "/internet/mensualidades",
    response_model=GeneracionMensualidadesInternetResponse,
)
def generar_mensualidades_internet_manual(
    data: GeneracionMensualidadesInternetCreate,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> GeneracionMensualidadesInternetResponse:
    """Genera manualmente el período sin registrar pagos ni movimientos de Caja."""

    _requerir_modulo_cobros(current_user, INTERNET_MONTHLY_GENERATION_MODULE)
    return generar_mensualidades_internet(db, data)


@router.get(
    "/ordenes-trabajo/cotizaciones",
    response_model=list[CotizacionOrdenCobroResponse],
)
def get_cotizaciones_orden(
    current_user: CurrentUser,
    id_cliente: int = Query(..., gt=0),
    db=Depends(get_db),
) -> list[CotizacionOrdenCobroResponse]:
    """Lista cotizaciones aceptadas con proforma para el cliente indicado."""

    _requerir_origen_pago(current_user, "ORDENES_TRABAJO")
    try:
        return listar_cotizaciones_orden(db, id_cliente)
    except PAGO_ERRORS as error:
        raise _pago_http_error(error) from None


@router.get(
    "/instalaciones/cotizaciones",
    response_model=list[CotizacionInstalacionCobroResponse],
)
def get_cotizaciones_instalacion(
    current_user: CurrentUser,
    id_cliente: int = Query(..., gt=0),
    db=Depends(get_db),
) -> list[CotizacionInstalacionCobroResponse]:
    """Lista cotizaciones EVALUACION aceptadas con proforma y saldo pendiente."""

    _requerir_origen_pago(current_user, "INSTALACIONES")
    try:
        return listar_cotizaciones_instalacion(db, id_cliente)
    except PAGO_ERRORS as error:
        raise _pago_http_error(error) from None


@router.get("/saldos-pendientes", response_model=CobrosPageResponse)
def get_saldos_pendientes(
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    estado: str | None = Query(default=None),
    periodo: str | None = Query(default=None),
    id_servicio: int | None = Query(default=None, gt=0),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    db=Depends(get_db),
) -> CobrosPageResponse:
    """Lista solo obligaciones con saldo positivo calculado desde pago_detalles."""

    origenes_permitidos = _origenes_pago_autorizados(current_user)
    try:
        return list_cobros(
            db,
            page=page,
            page_size=page_size,
            estado=estado,
            periodo=periodo,
            id_servicio=id_servicio,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            solo_pendientes=True,
            origenes_permitidos=origenes_permitidos,
        )
    except SaldoCobroInconsistenteError as error:
        raise _saldo_http_error(error) from None


@router.get("/historial", response_model=HistorialCobrosPageResponse)
def get_historial_cobros(
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    id_cobro: int | None = Query(default=None, gt=0),
    resultado: str | None = Query(default=None),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    db=Depends(get_db),
) -> HistorialCobrosPageResponse:
    """Consulta el historial real almacenado en gestiones_cobro."""

    origenes_permitidos = _origenes_pago_autorizados(current_user)
    return list_historial_cobros(
        db,
        page=page,
        page_size=page_size,
        id_cobro=id_cobro,
        resultado=resultado,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        origenes_permitidos=origenes_permitidos,
    )


@router.get("", response_model=CobrosPageResponse)
def get_cobros(
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    estado: str | None = Query(default=None),
    periodo: str | None = Query(default=None),
    id_servicio: int | None = Query(default=None, gt=0),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    db=Depends(get_db),
) -> CobrosPageResponse:
    """Pagina las obligaciones registradas con su saldo financiero calculado."""

    origenes_permitidos = _origenes_pago_autorizados(current_user)
    try:
        return list_cobros(
            db,
            page=page,
            page_size=page_size,
            estado=estado,
            periodo=periodo,
            id_servicio=id_servicio,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            origenes_permitidos=origenes_permitidos,
        )
    except SaldoCobroInconsistenteError as error:
        raise _saldo_http_error(error) from None


@router.post("/obligaciones-pendientes", response_model=CobroSaldoResponse)
def registrar_pendiente(
    data: RegistroPendienteCreate,
    current_user: CurrentUser,
    _empleado: ActiveSystemEmployee,
    db=Depends(get_db),
) -> CobroSaldoResponse:
    """Registra deuda sin dinero con el mismo JWT y permiso por origen de Cobros."""

    _requerir_origen_pago(current_user, data.origen_financiero)
    try:
        return registrar_obligacion_pendiente(db, data)
    except PAGO_ERRORS as error:
        raise _pago_http_error(error) from None


@router.post(
    "/pagos",
    response_model=PagoConfirmadoResponse,
    status_code=status.HTTP_201_CREATED,
)
def confirmar_pago(
    data: RegistroPagoCreate,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> PagoConfirmadoResponse:
    """Confirma el pago con el empleado autenticado solo despues de aplicar 008."""

    _requerir_origen_pago(current_user, data.origen_financiero)
    empleado = _empleado_para_confirmar_pago(current_user)
    try:
        return registrar_pago(
            db, data, empleado, id_usuario_registro=current_user.id,
            puede_recibir_en_caja=(current_user.rol.nombre == "Administrador" and _tiene_modulo_activo(current_user, "caja")),
        )
    except PAGO_ERRORS as error:
        raise _pago_http_error(error) from None


@router.get("/pagos", response_model=PagosSaldoDisponiblePageResponse)
def get_pagos_con_saldo(
    current_user: CurrentUser,
    id_cliente: int = Query(..., gt=0),
    origen_financiero: OrigenFinanciero = Query(...),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db=Depends(get_db),
) -> PagosSaldoDisponiblePageResponse:
    """Consulta anticipos disponibles sin bloquear ni modificar pagos."""

    _requerir_origen_pago(current_user, origen_financiero)
    try:
        return list_pagos_con_saldo(
            db,
            id_cliente=id_cliente,
            origen_financiero=origen_financiero,
            page=page,
            page_size=page_size,
        )
    except SaldoPagoInconsistenteError as error:
        raise _pago_http_error(error) from None


@router.post(
    "/pagos/{id_pago}/aplicaciones",
    response_model=PagoConfirmadoResponse,
    status_code=status.HTTP_200_OK,
)
def aplicar_pago_anticipado(
    id_pago: int,
    data: DistribucionPagoCreate,
    _current_user: CurrentUser,
    _empleado: ActiveSystemEmployee,
    db=Depends(get_db),
) -> PagoConfirmadoResponse:
    """Distribuye saldo confirmado sin registrar otro movimiento de Caja."""

    origen = db.scalar(select(Pago.origen_financiero).where(Pago.id_pago == id_pago))
    if origen is None:
        _origenes_pago_autorizados(_current_user)
    else:
        _requerir_origen_pago(_current_user, origen)
    try:
        return distribuir_pago(db, id_pago, data)
    except PAGO_ERRORS as error:
        raise _pago_http_error(error) from None


@router.get("/comprobantes", response_model=ComprobantesPageResponse)
def get_comprobantes(
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    id_cobro: int | None = Query(default=None, gt=0),
    id_cliente: int | None = Query(default=None, gt=0),
    db=Depends(get_db),
) -> ComprobantesPageResponse:
    """Consulta comprobantes emitidos para recuperarlos desde el historial."""

    # Los comprobantes PDF se conservan exclusivamente para Servicios de Internet.
    origenes_permitidos = tuple(
        origen
        for origen in _origenes_pago_autorizados(current_user)
        if origen == "INTERNET"
    )
    return list_comprobantes(
        db,
        page=page,
        page_size=page_size,
        id_cobro=id_cobro,
        id_cliente=id_cliente,
        origenes_permitidos=origenes_permitidos,
    )


@router.get("/reporte", response_model=ReporteCobrosResponse)
def get_reporte_cobros(
    administrator: Administrator,
    periodo: PeriodoReporte = Query(...),
    fecha: date = Query(...),
    db=Depends(get_db),
) -> ReporteCobrosResponse:
    """Genera la vista administrativa de pagos confirmados sin modificar datos."""

    nombre = f"{administrator.nombre} {administrator.apellido}".strip()
    usuario = f"{nombre} ({administrator.username})"
    return generar_reporte_cobros(db, periodo, fecha, usuario)


@router.get(
    "/configuracion-comprobantes/activa",
    response_model=ConfiguracionComprobanteResponse,
)
def get_active_receipt_configuration_endpoint(
    administrator: Administrator,
    db=Depends(get_db),
) -> ConfiguracionComprobanteResponse:
    """Consulta la configuración activa de los comprobantes de Cobros."""

    configuracion = get_active_receipt_configuration(db)
    if configuracion is None:
        raise HTTPException(
            status_code=404,
            detail="No hay una configuración de comprobantes activa",
        )
    return configuracion


@router.get(
    "/configuracion-comprobantes/ultima",
    response_model=ConfiguracionComprobanteResponse,
)
def get_latest_receipt_configuration_endpoint(
    administrator: Administrator,
    db=Depends(get_db),
) -> ConfiguracionComprobanteResponse:
    """Consulta la última versión guardada, aunque no esté activa."""

    configuracion = get_latest_receipt_configuration(db)
    if configuracion is None:
        raise HTTPException(
            status_code=404,
            detail="No hay configuraciones de comprobantes guardadas",
        )
    return configuracion


@router.post(
    "/configuracion-comprobantes",
    response_model=ConfiguracionComprobanteResponse,
    status_code=status.HTTP_201_CREATED,
)
def save_receipt_configuration_endpoint(
    data: ConfiguracionComprobanteCreate,
    administrator: Administrator,
    db=Depends(get_db),
) -> ConfiguracionComprobanteResponse:
    """Guarda una versión nueva y la activa para los próximos comprobantes."""

    try:
        return save_receipt_configuration(db, data)
    except ConfiguracionComprobanteConflictError:
        raise HTTPException(
            status_code=409,
            detail="No se pudo guardar la configuración de comprobantes",
        ) from None


@router.get("/comprobantes/{id_comprobante}", response_model=ComprobanteTicketResponse)
def get_comprobante_ticket(
    id_comprobante: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> ComprobanteTicketResponse:
    """Consulta el ticket emitido con el mismo permiso de Internet que su PDF."""

    comprobante = db.get(ComprobanteCobro, id_comprobante)
    if comprobante is None:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado")
    pago = db.get(Pago, comprobante.id_pago)
    if pago is None:
        raise HTTPException(status_code=404, detail="Pago del comprobante no encontrado")
    _requerir_origen_pago(current_user, pago.origen_financiero)
    if pago.origen_financiero != "INTERNET":
        raise HTTPException(status_code=404, detail="Comprobante de Internet no disponible")
    try:
        return consultar_ticket_emitido(db, comprobante, pago)
    except ComprobanteInconsistenteError:
        raise HTTPException(status_code=409, detail="Los importes del comprobante son inconsistentes") from None


@router.get("/comprobantes/{id_comprobante}/pdf")
def get_comprobante_pdf(
    id_comprobante: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> FileResponse:
    """Descarga el PDF persistido con la autorizacion financiera vigente."""

    comprobante = db.get(ComprobanteCobro, id_comprobante)
    if comprobante is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comprobante no encontrado",
        )
    origen = db.scalar(select(Pago.origen_financiero).where(Pago.id_pago == comprobante.id_pago))
    if origen is None:
        _origenes_pago_autorizados(current_user)
    else:
        _requerir_origen_pago(current_user, origen)
        if origen != "INTERNET":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El PDF del comprobante no esta disponible para este origen",
            )
    try:
        ruta = ruta_pdf_comprobante(comprobante)
    except ComprobantePdfNoDisponibleError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El PDF del comprobante no esta disponible",
        ) from None
    return FileResponse(
        ruta,
        media_type="application/pdf",
        filename=f"{comprobante.numero}.pdf",
    )


@router.get("/comprobantes/{id_comprobante}/pdf-termico")
def get_comprobante_pdf_termico(
    id_comprobante: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> Response:
    """Entrega una copia térmica actual sin alterar el PDF histórico.

    Reutiliza el generador vigente de 58 mm en memoria y conserva los mismos
    permisos del comprobante original. No escribe en PostgreSQL ni en disco.
    """

    comprobante = db.get(ComprobanteCobro, id_comprobante)
    if comprobante is None:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado")
    pago = db.get(Pago, comprobante.id_pago)
    if pago is None:
        raise HTTPException(status_code=404, detail="Pago del comprobante no encontrado")
    _requerir_origen_pago(current_user, pago.origen_financiero)
    if pago.origen_financiero != "INTERNET":
        raise HTTPException(status_code=404, detail="Comprobante de Internet no disponible")
    try:
        contenido = generar_pdf_termico(db, comprobante, pago)
    except ComprobanteInconsistenteError:
        raise HTTPException(
            status_code=409,
            detail="Los importes del comprobante son inconsistentes",
        ) from None
    except ComprobantePdfAlmacenamientoError:
        raise HTTPException(
            status_code=500,
            detail="No fue posible generar la copia térmica del comprobante",
        ) from None
    return Response(
        content=contenido,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{comprobante.numero}-58mm.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{id_cobro}/pagos", response_model=PagosAplicadosPageResponse)
def get_pagos_aplicados(
    id_cobro: int,
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    db=Depends(get_db),
) -> PagosAplicadosPageResponse:
    """Consulta las aplicaciones de pago vinculadas por la FK de pago_detalles."""

    origen = db.scalar(select(Cobro.origen_financiero).where(Cobro.id_cobro == id_cobro))
    if origen is None:
        _origenes_pago_autorizados(current_user)
    else:
        _requerir_origen_pago(current_user, origen)
    try:
        return list_pagos_aplicados(
            db,
            id_cobro,
            page=page,
            page_size=page_size,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
        )
    except CobroNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cobro no encontrado",
        ) from None


@router.get("/{id_cobro}", response_model=CobroSaldoResponse)
def get_cobro_by_id(
    id_cobro: int,
    current_user: CurrentUser,
    db=Depends(get_db),
) -> CobroSaldoResponse:
    """Obtiene el detalle de una obligacion sin inferir servicio ni cliente."""

    origen = db.scalar(select(Cobro.origen_financiero).where(Cobro.id_cobro == id_cobro))
    if origen is None:
        _origenes_pago_autorizados(current_user)
    else:
        _requerir_origen_pago(current_user, origen)
    try:
        cobro = get_cobro(db, id_cobro)
    except SaldoCobroInconsistenteError as error:
        raise _saldo_http_error(error) from None
    if cobro is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cobro no encontrado",
        )
    return cobro
