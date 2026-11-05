// ==========================================
// IMPORTS Y CONFIGURACION
// ==========================================
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, tap, timeout } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { Usuario } from '../../usuarios/models/usuario.models';
import { LoginRequest, TokenResponse } from '../models/auth.models';

const TOKEN_KEY = 'sistemawisp_access_token';
// Acota login y /me: una petición pendiente debe fallar y liberar finalize(),
// también cuando /me se consulta desde los guards de navegación.
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

// ==========================================
// SERVICIO DE AUTENTICACION
// ==========================================
@Injectable({ providedIn: 'root' })
export class AuthService {
  // ==========================================
  // DEPENDENCIAS Y ESTADO DE SESION
  // ==========================================
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<Usuario | null>(null);

  // ==========================================
  // LOGIN Y USUARIO ACTUAL
  // ==========================================
  login(credentials: LoginRequest): Observable<TokenResponse> {
    // Una autenticación nueva siempre parte sin credenciales heredadas.
    this.clearSession();
    return this.http.post<TokenResponse>(API_ENDPOINTS.login, credentials).pipe(
      timeout({ first: AUTH_REQUEST_TIMEOUT_MS }),
      tap((response) => {
        sessionStorage.setItem(TOKEN_KEY, response.access_token);
        this.currentUser.set(null);
      }),
    );
  }

  loadCurrentUser(): Observable<Usuario> {
    // Conserva el token de origen: una respuesta antigua no debe reemplazar
    // al usuario de un inicio de sesión más reciente.
    const token = this.getToken();
    return this.http.get<Usuario>(API_ENDPOINTS.me).pipe(
      timeout({ first: AUTH_REQUEST_TIMEOUT_MS }),
      tap((user) => {
        if (this.getToken() === token) this.currentUser.set(user);
      }),
    );
  }

  hasModule(moduleCode: string, user = this.currentUser()): boolean {
    return user?.modulos.some((modulo) => modulo.codigo === moduleCode && modulo.activo) ?? false;
  }

  isAdministrator(user = this.currentUser()): boolean {
    return user?.rol.nombre === 'Administrador';
  }

  ensureCurrentUser(): Observable<Usuario> {
    const user = this.currentUser();
    return user ? of(user) : this.loadCurrentUser();
  }

  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  // ==========================================
  // VALIDACION Y LIMPIEZA DE SESION
  // ==========================================
  hasValidSession(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }

    try {
      const encodedPayload = token.split('.')[1];
      if (!encodedPayload) {
        return false;
      }
      const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(
        atob(normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=')),
      ) as { exp?: number };
      return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  clearSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    this.currentUser.set(null);
  }

  logout(): void {
    this.clearSession();
    void this.router.navigate(['/login']);
  }
}
