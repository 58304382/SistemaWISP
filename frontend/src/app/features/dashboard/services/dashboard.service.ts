// ==========================================
// SERVICIO DEL DASHBOARD GERENCIAL
// ==========================================
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, timeout } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  DashboardComercial,
  DashboardFinanciero,
  DashboardFiltro,
  DashboardOperativo,
  PeriodoDashboard,
  ReporteCajaDashboard,
  ResumenDashboard,
} from '../models/dashboard.models';

// Una consulta gerencial no debe dejar la pantalla bloqueada indefinidamente.
const DASHBOARD_TIMEOUT_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  /** Obtiene las tarjetas consolidadas del período seleccionado. */
  obtenerResumen(filtro: DashboardFiltro): Observable<ResumenDashboard> {
    return this.solicitar<ResumenDashboard>(API_ENDPOINTS.dashboardResumen, filtro);
  }

  /** Obtiene indicadores financieros y sus series para gráficas. */
  obtenerFinanciero(filtro: DashboardFiltro): Observable<DashboardFinanciero> {
    return this.solicitar<DashboardFinanciero>(API_ENDPOINTS.dashboardFinanciero, filtro);
  }

  /** Obtiene clientes, servicios y series comerciales. */
  obtenerComercial(filtro: DashboardFiltro): Observable<DashboardComercial> {
    return this.solicitar<DashboardComercial>(API_ENDPOINTS.dashboardComercial, filtro);
  }

  /** Obtiene conteos y series operativas por módulo. */
  obtenerOperativo(filtro: DashboardFiltro): Observable<DashboardOperativo> {
    return this.solicitar<DashboardOperativo>(API_ENDPOINTS.dashboardOperativo, filtro);
  }

  /**
   * Reutiliza el reporte oficial de Caja General.
   *
   * Los importes de saldo, entradas, salidas y saldo esperado se reciben ya
   * calculados por FastAPI. Angular no replica ninguna fórmula financiera.
   */
  obtenerResumenCaja(
    periodo: Exclude<PeriodoDashboard, 'personalizado'>,
    fecha = this.fechaActual(),
  ): Observable<ReporteCajaDashboard> {
    const periodoReporte = {
      hoy: 'diario',
      semana: 'semanal',
      mes: 'mensual',
    }[periodo];
    const params = new HttpParams().set('periodo', periodoReporte).set('fecha', fecha);
    return this.http
      .get<ReporteCajaDashboard>(API_ENDPOINTS.reporteCaja, { params })
      .pipe(timeout({ first: DASHBOARD_TIMEOUT_MS }));
  }

  private solicitar<T>(url: string, filtro: DashboardFiltro): Observable<T> {
    return this.http
      .get<T>(url, { params: this.crearParametros(filtro) })
      .pipe(timeout({ first: DASHBOARD_TIMEOUT_MS }));
  }

  /** Solo el rango personalizado envía fechas; los presets usan la fecha actual. */
  private crearParametros(filtro: DashboardFiltro): HttpParams {
    const periodo: PeriodoDashboard = filtro.periodo;
    let params = new HttpParams().set('periodo', periodo);
    if (periodo === 'personalizado') {
      if (filtro.fecha_inicio) params = params.set('fecha_inicio', filtro.fecha_inicio);
      if (filtro.fecha_fin) params = params.set('fecha_fin', filtro.fecha_fin);
    }
    return params;
  }

  /** Fecha local del navegador sin desplazamiento por zona horaria. */
  private fechaActual(): string {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60_000;
    return new Date(hoy.getTime() - offset).toISOString().slice(0, 10);
  }
}
