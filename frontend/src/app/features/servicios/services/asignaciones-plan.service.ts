import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  AsignacionPlan,
  AsignacionPlanPayload,
  ClienteAsignacionCatalogo,
  EstadoAsignacionPlan,
  PlanAsignacionCatalogo,
} from '../models/asignacion-plan.models';

@Injectable({ providedIn: 'root' })
export class AsignacionesPlanService {
  private readonly http = inject(HttpClient);

  /** Lista asignaciones y permite delegar el filtro de estado al API. */
  getAll(estado?: EstadoAsignacionPlan): Observable<AsignacionPlan[]> {
    const params = estado ? new HttpParams().set('estado', estado) : undefined;
    return this.http.get<AsignacionPlan[]>(API_ENDPOINTS.asignacionesPlanes, { params });
  }

  getById(idAsignacion: number): Observable<AsignacionPlan> {
    return this.http.get<AsignacionPlan>(`${API_ENDPOINTS.asignacionesPlanes}/${idAsignacion}`);
  }

  /** Usa el catálogo propio de Servicios para no exigir permisos de Clientes. */
  getClientes(): Observable<ClienteAsignacionCatalogo[]> {
    return this.http.get<ClienteAsignacionCatalogo[]>(
      `${API_ENDPOINTS.asignacionesPlanes}/catalogos/clientes`,
    );
  }

  /** El backend entrega únicamente planes activos con su precio oficial. */
  getPlanes(): Observable<PlanAsignacionCatalogo[]> {
    return this.http.get<PlanAsignacionCatalogo[]>(
      `${API_ENDPOINTS.asignacionesPlanes}/catalogos/planes`,
    );
  }

  create(payload: AsignacionPlanPayload): Observable<AsignacionPlan> {
    return this.http.post<AsignacionPlan>(API_ENDPOINTS.asignacionesPlanes, payload);
  }

  update(idAsignacion: number, payload: AsignacionPlanPayload): Observable<AsignacionPlan> {
    return this.http.patch<AsignacionPlan>(
      `${API_ENDPOINTS.asignacionesPlanes}/${idAsignacion}`,
      payload,
    );
  }

  delete(idAsignacion: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.asignacionesPlanes}/${idAsignacion}`);
  }
}
