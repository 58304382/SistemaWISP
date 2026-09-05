import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { Usuario } from '../models/usuario.models';

function hasPlanesModule(user: Usuario): boolean {
  return user.modulos.some((modulo) => modulo.codigo === 'planes' && modulo.activo);
}

export const planesGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const currentUser = auth.currentUser();

  if (currentUser) {
    return hasPlanesModule(currentUser) ? true : router.createUrlTree(['/inicio']);
  }

  return auth.loadCurrentUser().pipe(
    map((user) => (hasPlanesModule(user) ? true : router.createUrlTree(['/inicio']))),
    catchError(() => of(router.createUrlTree(['/inicio']))),
  );
};
