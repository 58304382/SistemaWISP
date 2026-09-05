// ==========================================
// IMPORTS
// ==========================================
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

// ==========================================
// RUTAS PROTEGIDAS
// ==========================================
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.hasValidSession()) {
    return true;
  }

  auth.clearSession();
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};

// ==========================================
// RUTA DE INVITADOS
// ==========================================
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  // El token puede tener una expiración válida en el navegador y aun así haber
  // sido revocado o firmado con otra clave. Solo una sesión ya cargada evita
  // volver a mostrar el login; los tokens heredados se limpian al autenticarse.
  return auth.currentUser() ? inject(Router).createUrlTree(['/usuarios']) : true;
};
