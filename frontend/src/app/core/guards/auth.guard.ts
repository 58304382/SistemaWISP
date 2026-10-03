// ==========================================
// IMPORTS
// ==========================================
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from '../services/auth.service';

// ==========================================
// RUTAS PROTEGIDAS
// ==========================================
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.hasValidSession()) {
    auth.clearSession();
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  return auth.loadCurrentUser().pipe(
    map(() => true),
    catchError(() => {
      auth.clearSession();
      return of(
        router.createUrlTree(['/login'], {
          queryParams: { returnUrl: state.url },
        }),
      );
    }),
  );
};

// ==========================================
// RUTA DE INVITADOS
// ==========================================
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.hasValidSession()) {
    auth.clearSession();
    return true;
  }

  return auth.loadCurrentUser().pipe(
    map(() => router.createUrlTree(['/inicio'])),
    catchError(() => {
      auth.clearSession();
      return of(true);
    }),
  );
};
