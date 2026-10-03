import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CotizacionDirectaCreateDto,
  CotizacionEvaluacionCreateDto,
  CotizacionResponseDto,
  CotizacionUpdateDto,
  EstadoCotizacion,
  ProformaResponseDto,
} from '../../features/cotizaciones/cotizacion.models';
import { API_ENDPOINTS } from '../config/api.config';

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

  createDirect(data: CotizacionDirectaCreateDto): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(API_ENDPOINTS.cotizaciones, data);
  }

  createFromEvaluation(
    data: CotizacionEvaluacionCreateDto,
  ): Observable<CotizacionResponseDto> {
    return this.http.post<CotizacionResponseDto>(API_ENDPOINTS.cotizacionesDesdeEvaluacion, data);
  }

  update(idCotizacion: number, data: CotizacionUpdateDto): Observable<CotizacionResponseDto> {
    return this.http.patch<CotizacionResponseDto>(
      `${API_ENDPOINTS.cotizaciones}/${idCotizacion}`,
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
