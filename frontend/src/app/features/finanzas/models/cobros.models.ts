import { DineroApi } from './caja.models';

// Contratos exactos de Cobros; los importes Decimal pueden llegar como texto JSON.
export type OrigenFinanciero = 'INTERNET' | 'INSTALACIONES' | 'ORDENES_TRABAJO';
export type EstadoCobroApi = 'Pendiente' | 'Vencido' | 'Pagado';
export type TipoPagoOrden = 'ANTICIPO' | 'PENDIENTE' | 'TOTAL';

export interface CobroSaldo {
  tiene_comprobante?: boolean;
  id_cobro: number;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  id_instalacion: number | null;
  id_servicio: number | null;
  periodo: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  monto: DineroApi;
  estado: EstadoCobroApi;
  cliente_nombre: string;
  cliente_telefono: string | null;
  numero_cotizacion: string | null;
  id_proforma: number | null;
  tipo_instalacion: string | null;
  id_orden_trabajo: number | null;
  codigo_orden: string | null;
  total_pagado: DineroApi;
  saldo_pendiente: DineroApi;
}

export interface CobrosPage {
  items: CobroSaldo[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ServicioInternetCobro {
  id_asignacion: number;
  id_cliente: number;
  id_plan: number;
  costo_mensual: DineroApi;
  fecha_inicio: string;
  dia_vencimiento: number | null;
  estado: 'Activo' | 'Inactivo';
  fecha_creacion: string;
  fecha_actualizacion: string | null;
  cliente: {
    id_cliente: number;
    nombres: string;
    apellidos: string;
    estado: string;
  };
  plan: {
    id: number;
    nombre: string;
    velocidad: string;
    precio_mensual: DineroApi;
    estado: string;
  };
}

export interface DiaVencimientoServicioUpdate {
  dia_vencimiento: number;
}

export interface GeneracionMensualidadesInternetCreate {
  mes: number;
  anio: number;
}

export interface GeneracionMensualidadesInternetResponse {
  periodo: string;
  generadas: number;
  existentes: number;
  total_elegibles: number;
}

export interface MetodoPagoCobro {
  id_metodo_pago: number;
  nombre: string;
  descripcion: string | null;
  estado: string;
}

export interface AplicacionPagoCreate {
  id_cobro: number;
  concepto: string | null;
  monto_aplicado: number;
}

export interface PeriodoInternetPagoCreate {
  id_servicio: number;
  periodo: string;
}

export interface RegistroPagoCreate {
  recepcion_efectivo?: 'CAJA_GENERAL' | 'EMPLEADO' | null;
  id_empleado_receptor?: number | null;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  clave_idempotencia: string;
  id_metodo_pago: number;
  monto_total: number;
  tipo_pago?: TipoPagoOrden | null;
  referencia: string | null;
  observaciones: string | null;
  id_cotizacion?: number | null;
  aplicaciones: AplicacionPagoCreate[];
  periodos_internet?: PeriodoInternetPagoCreate[];
}

export interface DistribucionPagoCreate {
  aplicaciones: AplicacionPagoCreate[];
  id_cotizacion?: number | null;
}

export interface EmpleadoReceptorCobro {
  id_empleado: number;
  codigo: string;
  nombres: string;
  apellidos: string;
}

export interface PagoSaldoDisponible {
  id_pago: number;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  fecha_hora: string;
  id_metodo_pago: number;
  metodo_pago: string;
  monto_total: DineroApi;
  tipo_pago: TipoPagoOrden | null;
  monto_aplicado: DineroApi;
  monto_no_aplicado: DineroApi;
  referencia: string | null;
  observaciones: string | null;
}

export interface PagosSaldoDisponiblePage {
  items: PagoSaldoDisponible[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PagoDetalleConfirmado {
  id_pago: number;
  id_cobro: number;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  concepto: string | null;
  monto_aplicado: DineroApi;
}

export interface ConceptoComprobante {
  descripcion: string;
  periodo: string | null;
  monto: DineroApi;
}

export interface ComprobanteTicket {
  id_comprobante: number;
  id_pago: number;
  numero: string;
  fecha_emision: string;
  fecha_hora: string;
  archivo_pdf: string | null;
  id_cliente: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  origen_financiero: OrigenFinanciero;
  servicio: string;
  periodo: string | null;
  metodo_pago: string | null;
  responsable: string;
  subtotal: DineroApi;
  descuento: DineroApi;
  total: DineroApi;
  saldo_a_favor: DineroApi;
  agradecimiento: string;
  nota_fiscal?: string;
  empresa_nombre?: string;
  empresa_descripcion?: string;
  empresa_direccion?: string | null;
  empresa_telefono?: string | null;
  empresa_logo_url?: string | null;
  periodos?: string[];
  proxima_fecha_pago?: string | null;
  conceptos: ConceptoComprobante[];
}

export interface PagoConfirmado {
  id_pago: number;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  id_movimiento_caja: number;
  clave_idempotencia: string;
  id_metodo_pago: number;
  id_empleado: number;
  id_entrega: number | null;
  monto_total: DineroApi;
  tipo_pago: TipoPagoOrden | null;
  fecha_hora: string;
  referencia: string | null;
  observaciones: string | null;
  detalles: PagoDetalleConfirmado[];
  monto_aplicado: DineroApi;
  monto_no_aplicado: DineroApi;
  comprobante: ComprobanteTicket | null;
}

export interface ComprobanteResumen {
  id_comprobante: number;
  id_pago: number;
  numero: string;
  fecha_emision: string;
  fecha_hora: string;
  archivo_pdf: string | null;
  id_cliente: number;
  origen_financiero: OrigenFinanciero;
  cliente_nombre: string;
  metodo_pago: string;
  total: DineroApi;
  responsable: string;
}

export interface ComprobantesPage {
  items: ComprobanteResumen[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Una obligación pendiente no es un pago: no admite método, anticipo ni dinero recibido.
export interface RegistroPendienteCreate {
  id_cliente: number;
  origen_financiero: 'INSTALACIONES' | 'ORDENES_TRABAJO';
  id_cotizacion: number;
  tipo_pago: 'PENDIENTE';
  monto_total: 0;
}

export interface CotizacionOrdenCobro {
  id_cotizacion: number;
  numero_cotizacion: string;
  id_orden: number;
  codigo_orden: string;
  estado_orden: string;
  id_cliente: number;
  cliente_nombre: string;
  id_proforma: number;
  monto: DineroApi;
  total_pagado: DineroApi;
  saldo_pendiente: DineroApi;
  id_cobro: number | null;
  estado_cotizacion: string;
}

export interface CotizacionInstalacionCobro {
  id_cotizacion: number;
  numero_cotizacion: string;
  // Nulos mientras la visita no tenga una instalación programada.
  id_instalacion: number | null;
  estado_instalacion: string | null;
  id_cliente: number;
  cliente_nombre: string;
  id_proforma: number;
  monto: DineroApi;
  total_pagado: DineroApi;
  saldo_pendiente: DineroApi;
  id_cobro: number | null;
  estado_cotizacion: string;
}
