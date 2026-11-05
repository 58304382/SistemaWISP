// ==========================================
// SERVICIO DE ÓRDENES DE TRABAJO
// ==========================================
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  EstadoOrden,
  EvaluacionOrden,
  EvaluacionOrdenRegistro,
  FinalizacionOrdenRegistro,
  OrdenTrabajo,
  OrdenTrabajoCreate,
  OrdenTrabajoUpdate,
  TecnicoOrden,
  TipoTrabajo,
} from '../models/orden-trabajo.models';

@Injectable({ providedIn: 'root' })
export class OrdenesTrabajoService {
  private readonly http = inject(HttpClient);

  // ==========================================
  // CATALOGOS DEL FORMULARIO
  // ==========================================
  getTiposTrabajo(): Observable<TipoTrabajo[]> {
    return this.http.get<TipoTrabajo[]>(API_ENDPOINTS.tiposTrabajo, {
      params: new HttpParams().set('activos', 'true'),
    });
  }

  getTecnicos(): Observable<TecnicoOrden[]> {
    return this.http.get<TecnicoOrden[]>(`${API_ENDPOINTS.ordenesTrabajo}/tecnicos`);
  }

  // ==========================================
  // CRUD ADMINISTRATIVO
  // ==========================================
  getAll(estado?: EstadoOrden): Observable<OrdenTrabajo[]> {
    const options = estado
      ? { params: new HttpParams().set('estado', estado) }
      : {};
    return this.http.get<OrdenTrabajo[]>(API_ENDPOINTS.ordenesTrabajo, options);
  }

  getById(idOrden: number): Observable<OrdenTrabajo> {
    return this.http.get<OrdenTrabajo>(`${API_ENDPOINTS.ordenesTrabajo}/${idOrden}`);
  }

  create(data: OrdenTrabajoCreate): Observable<OrdenTrabajo> {
    return this.http.post<OrdenTrabajo>(API_ENDPOINTS.ordenesTrabajo, data);
  }

  update(idOrden: number, data: OrdenTrabajoUpdate): Observable<OrdenTrabajo> {
    return this.http.patch<OrdenTrabajo>(`${API_ENDPOINTS.ordenesTrabajo}/${idOrden}`, data);
  }

  delete(idOrden: number): Observable<OrdenTrabajo> {
    return this.http.delete<OrdenTrabajo>(`${API_ENDPOINTS.ordenesTrabajo}/${idOrden}`);
  }

  // ==========================================
  // ACCIONES DEL TECNICO ASIGNADO
  // ==========================================
  start(idOrden: number): Observable<OrdenTrabajo> {
    return this.http.post<OrdenTrabajo>(`${API_ENDPOINTS.ordenesTrabajo}/${idOrden}/iniciar`, null);
  }

  /** Valida en FastAPI que el técnico asignado puede continuar la reparación
   * (ACEPTADA, COMPLETADA o proforma previa); no cambia el estado de la orden. */
  continuar(idOrden: number): Observable<OrdenTrabajo> {
    return this.http.post<OrdenTrabajo>(
      `${API_ENDPOINTS.ordenesTrabajo}/${idOrden}/continuar`,
      null,
    );
  }

  getEvaluacion(idOrden: number): Observable<EvaluacionOrden> {
    return this.http.get<EvaluacionOrden>(
      `${API_ENDPOINTS.ordenesTrabajo}/${idOrden}/evaluacion`,
    );
  }

  registrarEvaluacion(
    idOrden: number,
    data: EvaluacionOrdenRegistro,
  ): Observable<OrdenTrabajo> {
    return this.http.post<OrdenTrabajo>(
      `${API_ENDPOINTS.ordenesTrabajo}/${idOrden}/evaluacion`,
      data,
    );
  }

  // Confirma la entrega reutilizando la finalización: FastAPI exige asignación,
  // cotización COMPLETADA por registro en Cobros, incluso pendiente Q0.00, sin exigir deuda cero.
  finalizar(idOrden: number, data: FinalizacionOrdenRegistro): Observable<OrdenTrabajo> {
    return this.http.post<OrdenTrabajo>(
      `${API_ENDPOINTS.ordenesTrabajo}/${idOrden}/finalizar`,
      data,
    );
  }
}
