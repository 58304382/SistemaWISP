import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { Instalacion, InstalacionCreate, InstalacionUpdate } from '../models/instalacion.models';

@Injectable({ providedIn: 'root' })
export class InstalacionesService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Instalacion[]> {
    return this.http.get<Instalacion[]>(API_ENDPOINTS.instalaciones);
  }

  create(data: InstalacionCreate): Observable<Instalacion> {
    return this.http.post<Instalacion>(API_ENDPOINTS.instalaciones, data);
  }

  getById(idInstalacion: number): Observable<Instalacion> {
    return this.http.get<Instalacion>(`${API_ENDPOINTS.instalaciones}/${idInstalacion}`);
  }

  update(idInstalacion: number, data: InstalacionUpdate): Observable<Instalacion> {
    return this.http.patch<Instalacion>(`${API_ENDPOINTS.instalaciones}/${idInstalacion}`, data);
  }

  start(idInstalacion: number): Observable<Instalacion> {
    return this.http.post<Instalacion>(
      `${API_ENDPOINTS.instalaciones}/${idInstalacion}/iniciar`,
      null,
    );
  }

  complete(
    idInstalacion: number,
    technicalObservations: string,
    evidence: File,
  ): Observable<Instalacion> {
    const data = new FormData();
    data.append('observaciones_tecnicas', technicalObservations);
    data.append('evidencia', evidence, evidence.name);
    return this.http.post<Instalacion>(
      `${API_ENDPOINTS.instalaciones}/${idInstalacion}/completar`,
      data,
    );
  }

  delete(idInstalacion: number): Observable<Instalacion> {
    return this.http.delete<Instalacion>(`${API_ENDPOINTS.instalaciones}/${idInstalacion}`);
  }
}
