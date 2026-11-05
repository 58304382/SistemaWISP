// ==========================================
// IMPORTS
// ==========================================
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { AuthService } from '../../features/auth/services/auth.service';

// ==========================================
// INTERCEPTOR DE AUTORIZACION Y SESION
// ==========================================
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();
  const isLoginRequest = request.method === 'POST' && request.url === API_ENDPOINTS.login;
  const authorizedRequest =
    token && !isLoginRequest
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(authorizedRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      // Un 401 solo invalida la sesión si la petición usó el token vigente.
      // Así, una respuesta antigua de /me no borra un inicio de sesión nuevo.
      if (error.status === 401 && !isLoginRequest && auth.getToken() === token) {
        auth.clearSession();
        if (router.url !== '/login') {
          void router.navigate(['/login'], {
            queryParams: { reason: 'expired' },
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
