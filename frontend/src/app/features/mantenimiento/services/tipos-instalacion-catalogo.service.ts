import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CATALOGOS, CatalogoClave, CatalogoPayload, RegistroCatalogo } from '../models/catalogos.models';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  TipoInstalacion,
  TipoInstalacionCreate,
  TipoInstalacionUpdate,
} from '../models/tipo-instalacion-catalogo.models';

@Injectable({ providedIn: 'root' })
export class TiposInstalacionCatalogoService {
  private readonly http = inject(HttpClient);

  /** Adapta únicamente los IDs de las seis tablas a la proyección del editor reutilizado. */
  getCatalogo(clave: CatalogoClave): Observable<RegistroCatalogo[]> {
    const config = CATALOGOS.find((item) => item.clave === clave)!;
    return this.http.get<Array<Omit<RegistroCatalogo, 'id_tipo_instalacion'> & Record<string, unknown>>>(config.listado).pipe(
      map((items) => items.map((item) => ({ ...item, id_tipo_instalacion: Number(item[config.campoId]) }))),
    );
  }

  guardarCatalogo(clave: CatalogoClave, payload: CatalogoPayload, id?: number): Observable<RegistroCatalogo> {
    const config = CATALOGOS.find((item) => item.clave === clave)!;
    const solicitud = id === undefined
      ? this.http.post<Omit<RegistroCatalogo, 'id_tipo_instalacion'> & Record<string, unknown>>(config.endpoint, payload)
      : this.http.patch<Omit<RegistroCatalogo, 'id_tipo_instalacion'> & Record<string, unknown>>(`${config.endpoint}/${id}`, payload);
    return solicitud.pipe(map((item) => ({ ...item, id_tipo_instalacion: Number(item[config.campoId]) })));
  }

  /** Lista activos e inactivos para la administración del catálogo. */
  getAll(): Observable<TipoInstalacion[]> {
    return this.http.get<TipoInstalacion[]>(API_ENDPOINTS.tiposInstalacionTodos);
  }

  create(payload: TipoInstalacionCreate): Observable<TipoInstalacion> {
    return this.http.post<TipoInstalacion>(API_ENDPOINTS.tiposInstalacion, payload);
  }

  /** Actualiza datos o estado; el backend valida las relaciones al inactivar. */
  update(
    idTipoInstalacion: number,
    payload: TipoInstalacionUpdate,
  ): Observable<TipoInstalacion> {
    return this.http.patch<TipoInstalacion>(
      `${API_ENDPOINTS.tiposInstalacion}/${idTipoInstalacion}`,
      payload,
    );
  }
}
