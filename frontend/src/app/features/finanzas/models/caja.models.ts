// Contratos exactos publicados por los endpoints de Caja General.
export type TipoMovimientoCaja = 'Ingreso' | 'Egreso';
export type DineroApi = number | string;

export interface AperturaCajaCreate {
  saldo_inicial: number;
}

export interface SesionCajaActual {
  id_sesion: number;
  id_empleado: number;
  fecha_apertura: string;
  fecha_cierre: string | null;
  saldo_inicial: DineroApi;
  saldo_final: DineroApi | null;
  estado: string;
  efectivo_disponible: DineroApi;
}

// El esperado enviado detecta cambios concurrentes; el backend recalcula importes,
// fecha, diferencia y responsable, sin aceptar esos datos como valores autoritativos.
export interface CierreCajaCreate {
  monto_contado: number;
  monto_sistema: number;
  observaciones: string | null;
}

export interface CierreCajaResponse extends SesionCajaActual {
  estado: 'Cerrada';
  arqueo: {
    id_arqueo: number;
    id_sesion: number;
    monto_sistema: DineroApi;
    monto_contado: DineroApi;
    diferencia: DineroApi;
    observaciones: string | null;
    fecha_hora: string;
  };
}

export interface CategoriaCaja {
  id_categoria: number;
  nombre: string;
  tipo: TipoMovimientoCaja;
  descripcion: string | null;
  estado: string;
}

export interface MetodoPagoCaja {
  id_metodo_pago: number;
  nombre: string;
  descripcion: string | null;
  estado: string;
}

export interface MovimientoManualCajaCreate {
  tipo: TipoMovimientoCaja;
  id_categoria: number;
  concepto: string;
  monto: number;
  id_metodo_pago: number;
  referencia: string | null;
  observaciones: string | null;
}

export interface MovimientoCajaDetalle {
  id_movimiento: number;
  id_sesion: number;
  id_categoria: number;
  id_metodo_pago: number | null;
  id_responsable: number;
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: DineroApi;
  referencia: string | null;
  id_salida_producto: number | null;
  observaciones: string | null;
  fecha_hora: string;
  categoria: string;
  metodo_pago: string | null;
  responsable: string;
  es_efectivo: boolean;
}

export interface MovimientosCajaPage {
  items: MovimientoCajaDetalle[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface FiltrosMovimientosCaja {
  page: number;
  page_size: number;
  id_sesion?: number;
  tipo?: TipoMovimientoCaja;
  id_categoria?: number;
  id_metodo_pago?: number;
  fecha_desde?: string;
  fecha_hasta?: string;
}

export interface PagoPendienteEntrega {
  id_pago: number;
  id_cliente: number;
  cliente: string;
  origen: string;
  fecha_hora: string;
  monto_recaudado: DineroApi;
  monto_entregado: DineroApi;
  gastos_autorizados: DineroApi;
  pendiente: DineroApi;
}

export interface EmpleadoConciliacion {
  id_empleado: number;
  codigo: string;
  empleado: string;
  recaudado: DineroApi;
  entregado: DineroApi;
  gastos: DineroApi;
  pendiente: DineroApi;
  pagos_pendientes: PagoPendienteEntrega[];
}

export interface GastoEntrega {
  concepto: string;
  monto: number;
  observaciones: string | null;
}

export interface EntregaEmpleadoCreate {
  id_sesion: number;
  id_empleado: number;
  clave_idempotencia: string;
  ids_pagos: number[];
  monto_entregado: number;
  gastos: GastoEntrega[];
  autorizar_gastos: boolean;
  observaciones: string | null;
}

export interface EntregaEmpleado {
  id_entrega: number;
  id_sesion: number;
  id_empleado: number;
  empleado: string;
  id_administrativo: number;
  responsable_recepcion: string;
  fecha_hora: string;
  monto_entregado: DineroApi;
  recaudado: DineroApi;
  gastos_autorizados: DineroApi;
  observaciones: string | null;
  pagos: { id_pago: number; cliente: string; origen: string; monto_entregado: DineroApi; monto_gasto_autorizado: DineroApi }[];
  gastos: GastoEntrega[];
}

export interface ConciliacionCaja {
  id_sesion: number;
  saldo_inicial: DineroApi;
  cobros: { origen: string; efectivo: DineroApi; transferencias: DineroApi; otros: DineroApi }[];
  recibido_directamente: DineroApi;
  entradas_efectivo: DineroApi;
  salidas_efectivo: DineroApi;
  total_efectivo: DineroApi;
  total_transferencias: DineroApi;
  total_entregado: DineroApi;
  gastos_autorizados: DineroApi;
  pendiente_entrega: DineroApi;
  historicos: PagoPendienteEntrega[];
  efectivo_sin_clasificar: DineroApi;
  efectivo_confirmado: DineroApi;
  efectivo_esperado: DineroApi | null;
  empleados: EmpleadoConciliacion[];
}
