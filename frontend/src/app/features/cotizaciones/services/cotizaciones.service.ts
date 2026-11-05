import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CotizacionDirectaCreateDto,
  CotizacionEvaluacionCreateDto,
  CotizacionOrdenEvaluacionCreateDto,
  CotizacionResponseDto,
  CotizacionUpdateDto,
  ConfiguracionDocumentoInputDto,
  ConfiguracionDocumentoResponseDto,
  EstadoCotizacion,
  OrdenEvaluacionPendienteDto,
  ProformaResponseDto,
  TrabajoAdicionalCreateDto,
} from '../models/cotizacion.models';
import { API_ENDPOINTS } from '../../../core/config/api.config';

// Servicio HTTP único para Cotizaciones y Proformas. El interceptor global
// agrega el JWT; ningún método administra tokens manualmente.
@Injectable({ providedIn: 'root' })
export class CotizacionesService {
  private readonly http = inject(HttpClient);

  list(estado?: EstadoCotizacion): Observable<CotizacionResponseDto[]> {
    const options = estado ? { params: new HttpParams().set('estado', estado) } : {};
    return this.http.get<CotizacionResponseDto[]>(API_ENDPOINTS.cotizaciones, options);
  }

  getById(idCotizacion: number): Observable<CotizacionResponseDto> {
    return this.http.get<CotizacionResponseDto>(`${API_ENDPOINTS.cotizaciones}/${idCotizacion}`);
  }

  getActiveDocumentConfiguration(): Observable<ConfiguracionDocumentoResponseDto> {
    return this.http.get<ConfiguracionDocumentoResponseDto>(
      `${API_ENDPOINTS.configuracionDocumentos}/activa`,
    );
  }

  getLatestDocumentConfiguration(): Observable<ConfiguracionDocumentoResponseDto> {
    return this.http.get<ConfiguracionDocumentoResponseDto>(
      `${API_ENDPOINTS.configuracionDocumentos}/ultima`,
    );
  }

  saveDocumentConfiguration(
    data: ConfiguracionDocumentoInputDto,
    logo: File | null,
  ): Observable<ConfiguracionDocumentoResponseDto> {
    const body = new FormData();
    Object.entries(data).forEach(([field, value]) => body.append(field, value));
    if (logo !== null) body.append('logo', logo);
    return this.http.post<ConfiguracionDocumentoResponseDto>(
      API_ENDPOINTS.configuracionDocumentos,
      body,
    );
  }

  publishDocumentConfiguration(
    idConfiguracion: number,
  ): Observable<ConfiguracionDocumentoResponseDto> {
    return this.http.post<ConfiguracionDocumentoResponseDto>(
      `${API_ENDPOINTS.configuracionDocumentos}/${idConfiguracion}/publicar`,
      null,
    );
  }

  createDirect(data: CotizacionDirectaCreateDto): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(API_ENDPOINTS.cotizaciones, data);
  }

  createFromEvaluation(
    data: CotizacionEvaluacionCreateDto,
  ): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(API_ENDPOINTS.cotizacionesDesdeEvaluacion, data);
  }

  /** Evaluaciones de órdenes pendientes de cotizar (sin cotización vinculada). */
  listOrdenesPendientes(): Observable<OrdenEvaluacionPendienteDto[]> {
    return this.http.get<OrdenEvaluacionPendienteDto[]>(
      API_ENDPOINTS.cotizacionesPendientesOrdenes,
    );
  }

  /** Crea en EN PROCESO la cotización precargada desde la evaluación de orden. */
  createFromOrdenEvaluacion(
    data: CotizacionOrdenEvaluacionCreateDto,
  ): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(
      API_ENDPOINTS.cotizacionesDesdeOrdenEvaluacion,
      data,
    );
  }

  update(idCotizacion: number, data: CotizacionUpdateDto): Observable<CotizacionResponseDto> {
    return this.http.patch<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}`,
      data,
    );
  }

  /** Trabajo adicional del técnico: reabre la cotización (ACEPTADA → EN PROCESO)
   * agregando conceptos sin precio; el administrador los valora después. */
  registrarTrabajoAdicional(
    idCotizacion: number,
    data: TrabajoAdicionalCreateDto,
  ): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/trabajo-adicional`,
      data,
    );
  }

  generate(idCotizacion: number): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/generar`,
      null,
    );
  }

  accept(idCotizacion: number): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/aceptar`,
      null,
    );
  }

  reject(idCotizacion: number): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/rechazar`,
      null,
    );
  }

  delete(idCotizacion: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.cotizaciones}/${idCotizacion}`);
  }

  generateProforma(idCotizacion: number): Observable<ProformaResponseDto> {
    return this.http.post<ProformaResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/proforma`,
      null,
    );
  }

  getProformaByQuotation(idCotizacion: number): Observable<ProformaResponseDto> {
    return this.http.get<ProformaResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}/proforma`,
    );
  }

  getProformaById(idProforma: number): Observable<ProformaResponseDto> {
    return this.http.get<ProformaResponseDto>(`${API_ENDPOINTS.proformas}/${idProforma}`);
  }
}
