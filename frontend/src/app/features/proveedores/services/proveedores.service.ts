import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  Departamento,
  EstadoProveedor,
  Municipio,
  Proveedor,
  ProveedorPayload,
} from '../models/proveedor.models';

@Injectable({ providedIn: 'root' })
export class ProveedoresService {
  private readonly http = inject(HttpClient);

  /** Lista proveedores activos e inactivos para la administración. */
  getAll(): Observable<Proveedor[]> {
    return this.http.get<Proveedor[]>(API_ENDPOINTS.proveedores);
  }

  /** Recupera el detalle actual antes de editar. */
  getById(idProveedor: number): Observable<Proveedor> {
    return this.http.get<Proveedor>(`${API_ENDPOINTS.proveedores}/${idProveedor}`);
  }

  /** Reutiliza los departamentos activos autorizados para Proveedores. */
  getDepartamentos(): Observable<Departamento[]> {
    return this.http.get<Departamento[]>(`${API_ENDPOINTS.proveedores}/departamentos`);
  }

  /** Filtra municipios activos por el departamento seleccionado. */
  getMunicipios(idDepartamento: number): Observable<Municipio[]> {
    return this.http.get<Municipio[]>(
      `${API_ENDPOINTS.proveedores}/departamentos/${idDepartamento}/municipios`,
    );
  }

  /** Registra un proveedor; PostgreSQL genera su identificador. */
  create(payload: ProveedorPayload): Observable<Proveedor> {
    return this.http.post<Proveedor>(API_ENDPOINTS.proveedores, payload);
  }

  /** Actualiza un proveedor usando el identificador solo en la URL. */
  update(idProveedor: number, payload: ProveedorPayload): Observable<Proveedor> {
    return this.http.put<Proveedor>(`${API_ENDPOINTS.proveedores}/${idProveedor}`, payload);
  }

  /** Elimina físicamente al proveedor cuando no tiene relaciones. */
  delete(idProveedor: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.proveedores}/${idProveedor}`);
  }

  /** Activa o inactiva sin modificar los demás datos. */
  setEstado(idProveedor: number, estado: EstadoProveedor): Observable<Proveedor> {
    return this.http.patch<Proveedor>(`${API_ENDPOINTS.proveedores}/${idProveedor}/estado`, {
      estado,
    });
  }
}
