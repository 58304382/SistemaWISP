// ==========================================
// IMPORTS
// ==========================================
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import {
  Cliente,
  ClienteCreate,
  ClienteUpdate,
  Departamento,
  Municipio,
} from '../models/cliente.models';

// ==========================================
// SERVICIO DE CLIENTES
// ==========================================
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private readonly http = inject(HttpClient);

  // ==========================================
  // CARGA DE CLIENTES Y CATALOGOS
  // ==========================================
  getAll(): Observable<Cliente[]> {
    return this.http.get<Cliente[]>(API_ENDPOINTS.clientes);
  }

  getById(id: number): Observable<Cliente> {
    return this.http.get<Cliente>(`${API_ENDPOINTS.clientes}/${id}`);
  }

  getDepartamentos(): Observable<Departamento[]> {
    return this.http.get<Departamento[]>(API_ENDPOINTS.departamentos);
  }

  getMunicipios(idDepartamento: number): Observable<Municipio[]> {
    return this.http.get<Municipio[]>(
      `${API_ENDPOINTS.departamentos}/${idDepartamento}/municipios`,
    );
  }

  // ==========================================
  // OPERACIONES DE CLIENTE
  // ==========================================
  create(data: ClienteCreate): Observable<Cliente> {
    return this.http.post<Cliente>(API_ENDPOINTS.clientes, data);
  }

  update(id: number, data: ClienteUpdate): Observable<Cliente> {
    return this.http.patch<Cliente>(`${API_ENDPOINTS.clientes}/${id}`, data);
  }

  delete(id: number): Observable<Cliente> {
    return this.http.delete<Cliente>(`${API_ENDPOINTS.clientes}/${id}`);
  }
}
