import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { CoordenadasApi, normalizarCoordenadas } from '../../mapas/models/coordenadas.models';
import { Tarea } from '../models/tarea.models';

type TareaApi = Omit<Tarea, 'latitud' | 'longitud'> & CoordenadasApi;

@Injectable({ providedIn: 'root' })
export class TareasService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Tarea[]> {
    return this.http
      .get<TareaApi[]>(API_ENDPOINTS.tareas)
      .pipe(map((tasks) => tasks.map((task) => ({ ...task, ...normalizarCoordenadas(task) }))));
  }
}
