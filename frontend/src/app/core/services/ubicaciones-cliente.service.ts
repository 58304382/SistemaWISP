import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { UbicacionCliente } from '../models/ubicacion-cliente.models';

@Injectable({ providedIn: 'root' })
export class UbicacionesClienteService {
  private readonly http = inject(HttpClient);

  /** Reutiliza el listado protegido de propiedades del cliente. */
  getByClient(idCliente: number): Observable<UbicacionCliente[]> {
    return this.http.get<UbicacionCliente[]>(
      `${API_ENDPOINTS.ubicacionesCliente}/cliente/${idCliente}`,
    );
  }

  /** Obtiene todas las propiedades una sola vez para el módulo Mapas. */
  getAll(): Observable<UbicacionCliente[]> {
    return this.http.get<UbicacionCliente[]>(API_ENDPOINTS.ubicacionesCliente);
  }
}
