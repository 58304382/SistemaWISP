// ==========================================
// IMPORTS Y TIPOS DE RESPUESTA
// ==========================================
import { HttpErrorResponse } from '@angular/common/http';

interface ValidationError {
  msg?: string;
}

interface ApiErrorBody {
  detail?: string | ValidationError[];
}

// ==========================================
// MENSAJES DE ERROR PARA LA INTERFAZ
// ==========================================
export function getApiErrorMessage(
  error: unknown,
  fallback = 'No fue posible completar la operación.',
): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (error.status === 0) {
    return 'No se pudo conectar con el servidor. Comprueba que la API esté disponible.';
  }

  if (error.status === 401) {
    return 'Tu sesión expiró. Inicia sesión nuevamente.';
  }

  if (error.status === 403) {
    return 'No tienes permisos para realizar esta acción.';
  }

  if (error.status === 404) {
    return 'El recurso solicitado no existe.';
  }

  if (error.status === 409) {
    const detail = (error.error as ApiErrorBody | null)?.detail;
    return typeof detail === 'string' ? detail : 'El recurso ya está registrado.';
  }

  if (error.status === 422) {
    const detail = (error.error as ApiErrorBody | null)?.detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => {
        const location = (item as ValidationError & { loc?: (string | number)[] }).loc ?? [];
        if (location.includes('password')) {
          return 'La contraseña debe tener al menos 8 caracteres.';
        }
        if (location.includes('modulo_ids')) {
          return 'Debe seleccionar al menos 2 módulos.';
        }
        if (location.includes('username')) {
          return 'El username es obligatorio.';
        }
        return 'Revisa los datos ingresados.';
      });
      return [...new Set(messages)].join(' ');
    }
    return typeof detail === 'string' ? detail : 'Revisa los datos ingresados.';
  }

  if (error.status >= 500) {
    return 'El servidor no pudo completar la operación. Inténtalo nuevamente.';
  }

  const detail = (error.error as ApiErrorBody | null)?.detail;
  return typeof detail === 'string' ? detail : fallback;
}
