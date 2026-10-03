import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { Antena } from '../models/antena.models';

@Injectable({ providedIn: 'root' })
export class AntenasService {
  private readonly http = inject(HttpClient);

  /** Carga una sola vez el catálogo que consumirá el mapa y sus filtros locales. */
  getAll(): Observable<Antena[]> {
    return this.http.get<Antena[]>(API_ENDPOINTS.antenas);
  }
}
