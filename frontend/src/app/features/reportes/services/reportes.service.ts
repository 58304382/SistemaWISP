import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  PeriodoReporte,
  ReporteCaja,
  ReporteCobros,
  ReporteCotizaciones,
  ReporteInstalaciones,
  ReporteSoporte,
} from '../models/reporte.models';

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly http = inject(HttpClient);

  /** Solicita una vista de solo lectura para el período seleccionado. */
  generarInstalaciones(
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<ReporteInstalaciones> {
    return this.solicitar(API_ENDPOINTS.reporteInstalaciones, periodo, fecha);
  }

  generarCotizaciones(
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<ReporteCotizaciones> {
    return this.solicitar(API_ENDPOINTS.reporteCotizaciones, periodo, fecha);
  }

  generarCobros(
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<ReporteCobros> {
    return this.solicitar(API_ENDPOINTS.reporteCobros, periodo, fecha);
  }

  generarCaja(
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<ReporteCaja> {
    return this.solicitar(API_ENDPOINTS.reporteCaja, periodo, fecha);
  }

  generarSoporte(
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<ReporteSoporte> {
    return this.solicitar(API_ENDPOINTS.reporteSoporte, periodo, fecha);
  }

  private solicitar<T>(
    url: string,
    periodo: PeriodoReporte,
    fecha: string,
  ): Observable<T> {
    const params = new HttpParams().set('periodo', periodo).set('fecha', fecha);
    return this.http.get<T>(url, { params });
  }
}
