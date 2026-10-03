// ==========================================
// IMPORTS
// ==========================================
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import {
  EmpleadoDisponible,
  Modulo,
  Usuario,
  UsuarioCreate,
  UsuarioUpdate,
} from '../models/usuario.models';

// ==========================================
// SERVICIO DE USUARIOS
// ==========================================
@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly http = inject(HttpClient);

  // ==========================================
  // CONSULTAS
  // ==========================================
  getAll(): Observable<Usuario[]> {
    return this.http.get<Usuario[]>(API_ENDPOINTS.usuarios);
  }

  getById(id: number): Observable<Usuario> {
    return this.http.get<Usuario>(`${API_ENDPOINTS.usuarios}/${id}`);
  }

  getModules(): Observable<Modulo[]> {
    return this.http.get<Modulo[]>(API_ENDPOINTS.modulos);
  }

  getAvailableEmployees(): Observable<EmpleadoDisponible[]> {
    return this.http.get<EmpleadoDisponible[]>(API_ENDPOINTS.empleadosDisponiblesUsuario);
  }

  // ==========================================
  // OPERACIONES DE USUARIO
  // ==========================================
  create(data: UsuarioCreate): Observable<Usuario> {
    return this.http.post<Usuario>(API_ENDPOINTS.usuarios, data);
  }

  update(id: number, data: UsuarioUpdate): Observable<Usuario> {
    return this.http.patch<Usuario>(`${API_ENDPOINTS.usuarios}/${id}`, data);
  }

  setActive(id: number, activo: boolean): Observable<Usuario> {
    return this.update(id, { activo });
  }
}
