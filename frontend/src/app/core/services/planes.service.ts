import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { Plan, PlanCreate, PlanUpdate, TipoPlan } from '../models/plan.models';

@Injectable({ providedIn: 'root' })
export class PlanesService {
  private readonly http = inject(HttpClient);

  getAll(tipoPlan: TipoPlan): Observable<Plan[]> {
    const params = new HttpParams().set('tipo_plan', tipoPlan);
    return this.http.get<Plan[]>(API_ENDPOINTS.planes, { params });
  }

  getById(id: number): Observable<Plan> {
    return this.http.get<Plan>(`${API_ENDPOINTS.planes}/${id}`);
  }

  create(data: PlanCreate): Observable<Plan> {
    return this.http.post<Plan>(API_ENDPOINTS.planes, data);
  }

  update(id: number, data: PlanUpdate): Observable<Plan> {
    return this.http.patch<Plan>(`${API_ENDPOINTS.planes}/${id}`, data);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.planes}/${id}`);
  }
}
