import type { EstadoCotizacion } from '../../cotizaciones/models/cotizacion.models';
import type { EstadoInstalacion } from '../../instalaciones/models/instalacion.models';
import type { EstadoTicket } from '../../soporte-tecnico/models/ticket.models';

export type PeriodoReporte = 'diario' | 'semanal' | 'mensual';
export type PeriodoReporteInstalaciones = PeriodoReporte;
export type TipoReporte =
  | 'instalaciones'
  | 'cotizaciones'
  | 'cobros'
  | 'caja'
  | 'soporte';

// Pydantic serializa Decimal como string; el componente solo lo formatea.
export type DecimalReporte = string;

export interface EstadoReporteInstalaciones {
  estado: EstadoInstalacion;
  cantidad: number;
}

export interface FilaReporteInstalacion {
  fecha: string;
  cliente: string;
  tipo_instalacion: string | null;
  tecnico_responsable: string | null;
  estado: EstadoInstalacion;
  observaciones: string | null;
}

export interface ReporteInstalaciones {
  titulo: string;
  periodo: PeriodoReporte;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_instalaciones: number;
  estados: EstadoReporteInstalaciones[];
  instalaciones: FilaReporteInstalacion[];
}

export interface FilaReporteCotizacion {
  fecha: string;
  cliente: string;
  origen: string;
  estado: EstadoCotizacion;
  referencia: string;
  importe: DecimalReporte;
}

export interface ReporteCotizaciones {
  tipo: 'cotizaciones';
  titulo: string;
  periodo: PeriodoReporte;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_cotizaciones: number;
  pendientes: number;
  aceptadas: number;
  importe_total: DecimalReporte;
  cotizaciones: FilaReporteCotizacion[];
}

export interface FilaReporteCobro {
  fecha: string;
  cliente: string;
  concepto: string;
  metodo_pago: string;
  referencia: string | null;
  importe: DecimalReporte;
}

export interface ConceptoReporteCobro {
  concepto: string;
  importe: DecimalReporte;
}

export interface ReporteCobros {
  tipo: 'cobros';
  titulo: string;
  periodo: PeriodoReporte;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_pagos: number;
  total_cobrado: DecimalReporte;
  conceptos: ConceptoReporteCobro[];
  cobros: FilaReporteCobro[];
}

export interface FilaReporteCaja {
  fecha: string;
  hora: string;
  tipo: 'Ingreso' | 'Egreso';
  concepto: string;
  metodo_pago: string | null;
  referencia: string | null;
  responsable: string;
  importe: DecimalReporte;
}

export interface ReporteCaja {
  tipo: 'caja';
  titulo: string;
  periodo: PeriodoReporte;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_movimientos: number;
  saldo_inicial: DecimalReporte;
  entradas: DecimalReporte;
  salidas: DecimalReporte;
  saldo_esperado: DecimalReporte;
  movimientos: FilaReporteCaja[];
}

export interface FilaReporteSoporte {
  fecha: string;
  cliente: string;
  categoria: string | null;
  tecnico: string | null;
  estado: EstadoTicket;
  resultado: string | null;
}

export interface ReporteSoporte {
  tipo: 'soporte';
  titulo: string;
  periodo: PeriodoReporte;
  periodo_descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_generacion: string;
  usuario_generador: string;
  total_tickets: number;
  programados: number;
  en_proceso: number;
  completados: number;
  tickets: FilaReporteSoporte[];
}
