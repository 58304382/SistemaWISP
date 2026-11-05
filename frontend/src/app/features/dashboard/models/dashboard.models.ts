// ==========================================
// CONTRATOS DEL DASHBOARD GERENCIAL
// ==========================================
// Los importes Decimal llegan como string desde FastAPI. El componente los
// convierte a número solo para dibujar gráficas y conserva el texto original
// para el resto de la interfaz.

export type PeriodoDashboard = 'hoy' | 'semana' | 'mes' | 'personalizado';
export type GranularidadDashboard = 'diaria' | 'mensual';

export interface DashboardFiltro {
  periodo: PeriodoDashboard;
  fecha_inicio?: string;
  fecha_fin?: string;
}

export interface PeriodoDashboardResponse {
  tipo: PeriodoDashboard;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion: string;
  granularidad: GranularidadDashboard;
}

export interface MontoPorOrigen {
  origen: string;
  monto: string;
  cantidad: number;
}

export interface IndicadoresFinancieros {
  ingresos: string;
  cobros_aplicados: string;
  cartera_pendiente: string;
  documentos_pendientes: number;
  morosidad_monto: string;
  documentos_vencidos: number;
  ingresos_por_origen: MontoPorOrigen[];
  cartera_por_origen: MontoPorOrigen[];
  morosidad_por_origen: MontoPorOrigen[];
}

export interface ConteoPorEstado {
  estado: string;
  cantidad: number;
}

export interface ConteoModulo {
  total: number;
  por_estado: ConteoPorEstado[];
}

export interface IndicadoresClientes {
  total: number;
  activos: number;
  inactivos: number;
  por_estado: ConteoPorEstado[];
}

export interface IndicadoresServicios {
  total: number;
  activos: number;
  inactivos: number;
  por_estado: ConteoPorEstado[];
  clientes_con_servicio_activo: number;
  ingreso_mensual_contratado: string;
}

export interface IndicadoresOperativos {
  visitas_tecnicas: ConteoModulo;
  instalaciones: ConteoModulo;
  cotizaciones: ConteoModulo;
  ordenes_trabajo: ConteoModulo;
  tickets: ConteoModulo;
}

export interface PuntoSerieMonto {
  fecha: string;
  monto: string;
}

export interface PuntoSerieCantidad {
  fecha: string;
  cantidad: number;
}

export interface PuntoSerieCartera {
  fecha: string;
  monto: string;
  documentos: number;
}

export interface SeriesFinancieras {
  ingresos: PuntoSerieMonto[];
  cobros_aplicados: PuntoSerieMonto[];
  cartera_por_vencimiento: PuntoSerieCartera[];
}

export interface SeriesComerciales {
  cotizaciones: PuntoSerieCantidad[];
  importe_cotizado: PuntoSerieMonto[];
}

export interface SeriesOperativas {
  visitas_tecnicas: PuntoSerieCantidad[];
  instalaciones: PuntoSerieCantidad[];
  cotizaciones: PuntoSerieCantidad[];
  ordenes_trabajo: PuntoSerieCantidad[];
  tickets: PuntoSerieCantidad[];
}

export interface ResumenDashboard {
  periodo: PeriodoDashboardResponse;
  generado_en: string;
  financiero: IndicadoresFinancieros;
  clientes: IndicadoresClientes;
  servicios: IndicadoresServicios;
  operativo: IndicadoresOperativos;
}

export interface DashboardFinanciero {
  periodo: PeriodoDashboardResponse;
  generado_en: string;
  indicadores: IndicadoresFinancieros;
  series: SeriesFinancieras;
}

export interface DashboardComercial {
  periodo: PeriodoDashboardResponse;
  generado_en: string;
  clientes: IndicadoresClientes;
  servicios: IndicadoresServicios;
  cotizaciones: ConteoModulo;
  series: SeriesComerciales;
}

export interface DashboardOperativo {
  periodo: PeriodoDashboardResponse;
  generado_en: string;
  operativo: IndicadoresOperativos;
  series: SeriesOperativas;
}

// ==========================================
// RESUMEN FINANCIERO DE CAJA GENERAL
// ==========================================
export type PeriodoReporteCaja = 'diario' | 'semanal' | 'mensual';

export interface ReporteCajaDashboard {
  tipo: 'caja';
  titulo: string;
  periodo: PeriodoReporteCaja;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_movimientos: number;
  saldo_inicial: string;
  entradas: string;
  salidas: string;
  saldo_esperado: string;
}

// ==========================================
// ALERTAS DEL DASHBOARD
// ==========================================
export type NivelAlertaDashboard = 'critica' | 'atencion' | 'informativa';

export interface DashboardAlerta {
  nivel: NivelAlertaDashboard;
  titulo: string;
  mensaje: string;
  monto?: string;
}

// ==========================================
// CONTRATOS INTERNOS DE LAS GRÁFICAS
// ==========================================
export interface LineaSerieDashboard {
  nombre: string;
  color: string;
  valores: number[];
}

export interface BarraDashboard {
  etiqueta: string;
  valor: number;
  detalle?: string;
  color?: string;
}

export interface OpcionPeriodoDashboard {
  codigo: PeriodoDashboard;
  nombre: string;
}

export interface EstadoOperativoDashboard {
  estado: string;
  cantidad: number;
  porcentaje: number;
  color: string;
}

export interface ModuloOperativoDashboard {
  clave: string;
  nombre: string;
  total: number;
  estados: EstadoOperativoDashboard[];
}
