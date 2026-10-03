import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { Tarea } from '../models/tarea.models';

@Injectable({ providedIn: 'root' })
export class TareasService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Tarea[]> {
    return this.http.get<Tarea[]>(API_ENDPOINTS.tareas);
  }
}
