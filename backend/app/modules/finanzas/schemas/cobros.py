"""Contratos Pydantic para cobros, pagos y su seguimiento."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


EstadoCatalogo = Literal["Activo", "Inactivo"]
EstadoCobro = Literal["Pendiente", "Vencido", "Pagado"]
OrigenFinanciero = Literal["INTERNET", "INSTALACIONES", "ORDENES_TRABAJO"]
TipoPagoOrden = Literal["ANTICIPO", "PENDIENTE", "TOTAL"]


class FinanzasInput(BaseModel):
    """Configuracion comun para rechazar campos ajenos al contrato financiero."""

    model_config = ConfigDict(extra="forbid")


class FinanzasResponse(BaseModel):
    """Configuracion comun para serializar instancias SQLAlchemy."""

    model_config = ConfigDict(from_attributes=True)


class MetodoPagoCreate(FinanzasInput):
    nombre: str = Field(min_length=1)
    descripcion: str | None = None
    estado: EstadoCatalogo

    @field_validator("nombre", "estado")
    @classmethod
    def texto_obligatorio_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacio")
        return value


class MetodoPagoUpdate(FinanzasInput):
    nombre: str | None = Field(default=None, min_length=1)
    descripcion: str | None = None
    estado: EstadoCatalogo | None = None

    @field_validator("nombre", "estado")
    @classmethod
    def texto_opcional_no_vacio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El valor no puede estar vacio")
        return value


class MetodoPagoResponse(FinanzasResponse):
    id_metodo_pago: int
    nombre: str
    descripcion: str | None
    estado: EstadoCatalogo


class CobroCreate(FinanzasInput):
    """Crea una obligacion identificada por cliente y origen financiero."""

    id_cliente: int = Field(gt=0)
    origen_financiero: OrigenFinanciero
    id_instalacion: int | None = Field(default=None, gt=0)
    id_servicio: int | None = Field(default=None, gt=0)
    periodo: str | None = None
    fecha_emision: date
    fecha_vencimiento: date | None = None
    monto: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    estado: EstadoCobro

    @model_validator(mode="after")
    def validar_origen_y_fechas(self) -> Self:
        """Exige instalacion solo cuando constituye la fuente del cobro."""

        if self.fecha_vencimiento and self.fecha_vencimiento < self.fecha_emision:
            raise ValueError("La fecha de vencimiento no puede preceder a la emision")
        if self.origen_financiero == "INSTALACIONES" and self.id_instalacion is None:
            raise ValueError("El origen Instalaciones requiere id_instalacion")
        if self.origen_financiero != "INSTALACIONES" and self.id_instalacion is not None:
            raise ValueError("id_instalacion solo corresponde al origen Instalaciones")
        return self


class CobroUpdate(FinanzasInput):
    id_cliente: int | None = Field(default=None, gt=0)
    origen_financiero: OrigenFinanciero | None = None
    id_instalacion: int | None = Field(default=None, gt=0)
    id_servicio: int | None = Field(default=None, gt=0)
    periodo: str | None = None
    fecha_vencimiento: date | None = None
    monto: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    estado: EstadoCobro | None = None

    @model_validator(mode="after")
    def validar_origen_incluido(self) -> Self:
        """Valida la pareja origen-instalacion cuando ambos datos se actualizan."""

        if self.origen_financiero == "INSTALACIONES" and self.id_instalacion is None:
            raise ValueError("El origen Instalaciones requiere id_instalacion")
        if self.origen_financiero not in (None, "INSTALACIONES") and self.id_instalacion:
            raise ValueError("id_instalacion solo corresponde al origen Instalaciones")
        return self


class CobroResponse(FinanzasResponse):
    id_cobro: int
    id_cliente: int
    origen_financiero: OrigenFinanciero
    id_instalacion: int | None
    id_servicio: int | None
    periodo: str | None
    fecha_emision: date
    fecha_vencimiento: date | None
    monto: Decimal
    estado: EstadoCobro


class GeneracionMensualidadesInternetCreate(FinanzasInput):
    """Período mensual solicitado para generar obligaciones de Internet."""

    mes: int = Field(ge=1, le=12)
    anio: int = Field(ge=1, le=9999)


class GeneracionMensualidadesInternetResponse(BaseModel):
    """Resumen idempotente de la generación manual de mensualidades."""

    periodo: str
    generadas: int
    existentes: int
    total_elegibles: int


class PagoCreate(FinanzasInput):
    """Datos externos del pago; Caja genera internamente su movimiento unico."""

    id_cliente: int = Field(gt=0)
    origen_financiero: OrigenFinanciero
    clave_idempotencia: UUID
    id_metodo_pago: int = Field(gt=0)
    id_empleado: int = Field(gt=0)
    id_entrega: None = None
    monto_total: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    tipo_pago: TipoPagoOrden | None = None
    referencia: str | None = Field(default=None, max_length=100)
    observaciones: str | None = None

    @model_validator(mode="after")
    def validar_tipo_pago(self) -> Self:
        """Restringe la clasificacion a pagos de proyecto cobrable."""

        if self.origen_financiero == "ORDENES_TRABAJO" and self.tipo_pago is None:
            raise ValueError("El origen Ordenes de trabajo requiere tipo_pago")
        if (
            self.origen_financiero not in ("ORDENES_TRABAJO", "INSTALACIONES")
            and self.tipo_pago is not None
        ):
            raise ValueError(
                "tipo_pago solo corresponde a Ordenes de trabajo o Instalaciones"
            )
        return self


class PagoUpdate(FinanzasInput):
    # La distribucion de entregas se realiza mediante entrega_pago_detalles.
    id_entrega: None = None
    referencia: str | None = Field(default=None, max_length=100)
    observaciones: str | None = None


class PagoResponse(FinanzasResponse):
    id_pago: int
    id_cliente: int
    origen_financiero: OrigenFinanciero
    id_movimiento_caja: int
    clave_idempotencia: UUID
    id_metodo_pago: int
    id_empleado: int
    id_entrega: int | None
    monto_total: Decimal
    tipo_pago: TipoPagoOrden | None
    fecha_hora: datetime
    referencia: str | None
    observaciones: str | None


class PagoDetalleCreate(FinanzasInput):
    id_pago: int = Field(gt=0)
    id_cobro: int = Field(gt=0)
    concepto: str | None = None
    monto_aplicado: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class PagoDetalleResponse(FinanzasResponse):
    id_pago: int
    id_cobro: int
    id_cliente: int
    origen_financiero: OrigenFinanciero
    concepto: str | None
    monto_aplicado: Decimal


class AplicacionPagoCreate(FinanzasInput):
    """Importe del pago que se aplica a una obligacion concreta."""

    id_cobro: int = Field(gt=0)
    concepto: str | None = None
    monto_aplicado: Decimal = Field(gt=0, max_digits=10, decimal_places=2)

    @field_validator("concepto")
    @classmethod
    def concepto_normalizado(cls, value: str | None) -> str | None:
        """Evita diferencias idempotentes causadas solo por espacios."""

        if value is None:
            return None
        return value.strip() or None


class PeriodoInternetPagoCreate(FinanzasInput):
    """Mensualidad de Internet que debe resolverse dentro del pago."""

    id_servicio: int = Field(gt=0)
    periodo: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class RegistroPendienteCreate(FinanzasInput):
    """Registra solo la obligacion: no acepta dinero, metodo ni aplicaciones de pago."""

    id_cliente: int = Field(gt=0)
    origen_financiero: Literal["INSTALACIONES", "ORDENES_TRABAJO"]
    id_cotizacion: int = Field(gt=0)
    tipo_pago: Literal["PENDIENTE"] = "PENDIENTE"
    monto_total: Decimal = Field(default=Decimal("0.00"), ge=0, le=0)


class RegistroPagoCreate(FinanzasInput):
    """Confirma un pago y permite conservar una parte como saldo anticipado."""

    id_cliente: int = Field(gt=0)
    origen_financiero: OrigenFinanciero
    clave_idempotencia: UUID
    id_metodo_pago: int = Field(gt=0)
    monto_total: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    recepcion_efectivo: Literal["CAJA_GENERAL", "EMPLEADO"] | None = None
    id_empleado_receptor: int | None = Field(default=None, gt=0)
    tipo_pago: TipoPagoOrden | None = None
    referencia: str | None = Field(default=None, max_length=100)
    observaciones: str | None = None
    # Para ORDENES_TRABAJO e INSTALACIONES: identifica la cotizacion aceptada
    # que origina o reutiliza la obligacion financiera durante este pago.
    id_cotizacion: int | None = Field(default=None, gt=0)
    aplicaciones: list[AplicacionPagoCreate] = Field(
        default_factory=list,
        max_length=100,
    )
    periodos_internet: list[PeriodoInternetPagoCreate] = Field(
        default_factory=list,
        max_length=12,
    )

    @field_validator("referencia", "observaciones")
    @classmethod
    def texto_opcional_normalizado(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def validar_distribucion(self) -> Self:
        """Impide aplicaciones duplicadas o superiores al pago recibido."""

        # PENDIENTE no representa dinero recibido; usa el registro de obligaciones.
        if self.tipo_pago == "PENDIENTE":
            raise ValueError("Pago pendiente se registra como obligacion sin recibir dinero")
        # La entrega por empleado pertenece exclusivamente a la cobranza de Internet.
        if self.origen_financiero != "INTERNET" and (
            self.recepcion_efectivo is not None
            or self.id_empleado_receptor is not None
        ):
            raise ValueError("La custodia de efectivo solo corresponde a cobros de Internet")
        if self.origen_financiero != "INTERNET" and self.periodos_internet:
            raise ValueError("periodos_internet solo corresponde al origen Internet")
        if (
            self.origen_financiero == "INTERNET"
            and not self.aplicaciones
            and not self.periodos_internet
        ):
            raise ValueError("Internet requiere aplicaciones y/o periodos_internet")
        if self.origen_financiero == "ORDENES_TRABAJO" and self.id_cotizacion is None:
            raise ValueError("El origen Ordenes de trabajo requiere id_cotizacion")
        if self.origen_financiero == "ORDENES_TRABAJO" and self.tipo_pago is None:
            raise ValueError("El origen Ordenes de trabajo requiere tipo_pago")
        if self.origen_financiero == "INSTALACIONES":
            # La cotizacion y el tipo de pago describen juntos el cobro de una
            # instalacion y por ello deben informarse o omitirse siempre juntos.
            if (self.id_cotizacion is None) != (self.tipo_pago is None):
                raise ValueError(
                    "La cotizacion de instalacion y el tipo de pago deben "
                    "informarse juntos"
                )
        else:
            if self.id_cotizacion is not None and self.origen_financiero != "ORDENES_TRABAJO":
                raise ValueError(
                    "id_cotizacion solo corresponde a Ordenes de trabajo o Instalaciones"
                )
            if self.tipo_pago is not None and self.origen_financiero != "ORDENES_TRABAJO":
                raise ValueError(
                    "tipo_pago solo corresponde a Ordenes de trabajo o Instalaciones"
                )
        ids_cobro = [aplicacion.id_cobro for aplicacion in self.aplicaciones]
        if len(ids_cobro) != len(set(ids_cobro)):
            raise ValueError("Cada cobro solo puede aparecer una vez en el pago")
        periodos = [
            (periodo.id_servicio, periodo.periodo)
            for periodo in self.periodos_internet
        ]
        if len(periodos) != len(set(periodos)):
            raise ValueError("Cada servicio y periodo solo puede aparecer una vez")
        total_aplicado = sum(
            (aplicacion.monto_aplicado for aplicacion in self.aplicaciones),
            start=Decimal("0.00"),
        )
        if total_aplicado > self.monto_total:
            raise ValueError("La distribucion no puede superar el monto total")
        return self


class DistribucionPagoCreate(FinanzasInput):
    """Agrega aplicaciones nuevas a un pago con saldo no distribuido."""

    aplicaciones: list[AplicacionPagoCreate] = Field(min_length=1, max_length=100)
    # Permite identificar la cotizacion de orden o instalacion cuando la
    # obligacion aun no existe y debe generarse durante la distribucion.
    id_cotizacion: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validar_cobros_unicos(self) -> Self:
        """Hace idempotente cada pareja pago-cobro en una solicitud."""

        ids_cobro = [aplicacion.id_cobro for aplicacion in self.aplicaciones]
        if len(ids_cobro) != len(set(ids_cobro)):
            raise ValueError("Cada cobro solo puede aparecer una vez en la distribucion")
        return self


class ConceptoComprobanteResponse(BaseModel):
    """Concepto aplicado al pago dentro del ticket."""

    descripcion: str
    periodo: str | None
    monto: Decimal


class ComprobanteTicketResponse(BaseModel):
    """Ticket completo de un comprobante de pago emitido."""

    id_comprobante: int
    id_pago: int
    numero: str
    fecha_emision: date
    fecha_hora: datetime
    archivo_pdf: str | None
    id_cliente: int
    cliente_nombre: str
    cliente_telefono: str | None
    origen_financiero: OrigenFinanciero
    servicio: str
    periodo: str | None
    metodo_pago: str | None
    responsable: str
    subtotal: Decimal
    descuento: Decimal
    total: Decimal
    saldo_a_favor: Decimal
    agradecimiento: str
    nota_fiscal: str = "No constituye comprobante fiscal."
    empresa_nombre: str = "Multiservicios Tale"
    empresa_descripcion: str = "Servicios de Internet y telecomunicaciones"
    empresa_direccion: str | None = None
    empresa_telefono: str | None = None
    empresa_logo_url: str | None = None
    periodos: list[str] = Field(default_factory=list)
    proxima_fecha_pago: date | None = None
    conceptos: list[ConceptoComprobanteResponse]


class PagoConfirmadoResponse(PagoResponse):
    """Pago confirmado con sus aplicaciones y saldo aun no distribuido."""

    detalles: list[PagoDetalleResponse]
    monto_aplicado: Decimal
    monto_no_aplicado: Decimal
    comprobante: ComprobanteTicketResponse | None = None


class ComprobanteResumenResponse(BaseModel):
    """Datos minimos para recuperar un comprobante desde el historial."""

    id_comprobante: int
    id_pago: int
    numero: str
    fecha_emision: date
    fecha_hora: datetime
    archivo_pdf: str | None
    id_cliente: int
    origen_financiero: OrigenFinanciero
    cliente_nombre: str
    metodo_pago: str
    total: Decimal
    responsable: str


class ComprobantesPageResponse(BaseModel):
    """Pagina de comprobantes emitidos."""

    items: list[ComprobanteResumenResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CotizacionOrdenCobroResponse(BaseModel):
    """Cotizacion aceptada de una orden, lista para pago o anticipo."""

    id_cotizacion: int
    numero_cotizacion: str
    id_orden: int
    codigo_orden: str
    estado_orden: str
    id_cliente: int
    cliente_nombre: str
    id_proforma: int
    monto: Decimal
    total_pagado: Decimal
    saldo_pendiente: Decimal
    id_cobro: int | None
    estado_cotizacion: str


class CotizacionInstalacionCobroResponse(BaseModel):
    """Cotizacion EVALUACION aceptada, lista para pago o anticipo de instalacion."""

    id_cotizacion: int
    numero_cotizacion: str
    # Nulos mientras la visita no tenga una instalacion programada.
    id_instalacion: int | None
    estado_instalacion: str | None
    id_cliente: int
    cliente_nombre: str
    id_proforma: int
    monto: Decimal
    total_pagado: Decimal
    saldo_pendiente: Decimal
    id_cobro: int | None
    estado_cotizacion: str


class PagoSaldoDisponibleResponse(BaseModel):
    """Pago confirmado que aun conserva importe sin aplicar a obligaciones."""

    id_pago: int
    id_cliente: int
    origen_financiero: OrigenFinanciero
    fecha_hora: datetime
    id_metodo_pago: int
    metodo_pago: str
    monto_total: Decimal
    tipo_pago: TipoPagoOrden | None
    monto_aplicado: Decimal
    monto_no_aplicado: Decimal
    referencia: str | None
    observaciones: str | None


class PagosSaldoDisponiblePageResponse(BaseModel):
    """Pagina de anticipos disponibles para un cliente y origen concretos."""

    items: list[PagoSaldoDisponibleResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ComprobanteCobroCreate(FinanzasInput):
    id_pago: int = Field(gt=0)
    numero: str = Field(min_length=1)
    fecha_emision: date
    archivo_pdf: str | None = None

    @field_validator("numero")
    @classmethod
    def numero_no_vacio(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El numero del comprobante no puede estar vacio")
        return value


class ComprobanteCobroResponse(FinanzasResponse):
    id_comprobante: int
    id_pago: int
    numero: str
    fecha_emision: date
    archivo_pdf: str | None


class GestionCobroCreate(FinanzasInput):
    id_cobro: int = Field(gt=0)
    id_empleado: int = Field(gt=0)
    id_usuario: int = Field(gt=0)
    resultado: str | None = None
    observaciones: str | None = None


class GestionCobroResponse(FinanzasResponse):
    id_gestion: int
    id_cobro: int
    id_empleado: int
    id_usuario: int
    fecha_hora: datetime
    resultado: str | None
    observaciones: str | None


# ==========================================
# RESPUESTAS DE CONSULTA DE COBROS
# ==========================================
class CobroSaldoResponse(CobroResponse):
    """Obligacion con sus importes calculados desde aplicaciones de pago reales."""

    cliente_nombre: str
    cliente_telefono: str | None
    numero_cotizacion: str | None
    id_proforma: int | None
    tipo_instalacion: str | None
    id_orden_trabajo: int | None = None
    codigo_orden: str | None = None
    total_pagado: Decimal
    saldo_pendiente: Decimal
    # Indicador de consulta derivado de PagoDetalle → Comprobante, sin columna nueva.
    tiene_comprobante: bool = False


class CobrosPageResponse(BaseModel):
    """Pagina estable de obligaciones para evitar listados financieros ilimitados."""

    items: list[CobroSaldoResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class PagoAplicadoResponse(BaseModel):
    """Pago y monto aplicado especificamente a una obligacion."""

    id_pago: int
    id_cobro: int
    id_cliente: int
    origen_financiero: OrigenFinanciero
    id_movimiento_caja: int
    clave_idempotencia: UUID
    fecha_hora: datetime
    monto_total_pago: Decimal
    monto_aplicado: Decimal
    concepto: str | None
    id_metodo_pago: int
    metodo_pago: str
    id_empleado: int
    referencia: str | None
    observaciones: str | None


class PagosAplicadosPageResponse(BaseModel):
    items: list[PagoAplicadoResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class HistorialCobrosPageResponse(BaseModel):
    """Pagina cronologica de gestiones registradas sobre obligaciones."""

    items: list[GestionCobroResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
