import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { AuthService } from '../../features/auth/services/auth.service';

function redirectToLogin(auth: AuthService, router: Router, returnUrl: string) {
  auth.clearSession();
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
}

function redirectToHome(router: Router) {
  return router.createUrlTree(['/inicio']);
}

export const moduleAccessGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const moduleCode = route.data['module'] as string | undefined;
  const moduleCodes = (route.data['modules'] as string[] | undefined) ??
    (moduleCode ? [moduleCode] : []);

  if (moduleCodes.length === 0) {
    return redirectToHome(router);
  }

  if (!auth.hasValidSession()) {
    return redirectToLogin(auth, router, state.url);
  }

  return auth.ensureCurrentUser().pipe(
    map((user) =>
      auth.isAdministrator(user) || moduleCodes.some((code) => auth.hasModule(code, user))
        ? true
        : redirectToHome(router),
    ),
    catchError(() => of(redirectToLogin(auth, router, state.url))),
  );
};

export const administratorGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.hasValidSession()) {
    return redirectToLogin(auth, router, state.url);
  }

  return auth.ensureCurrentUser().pipe(
    map((user) => (auth.isAdministrator(user) ? true : redirectToHome(router))),
    catchError(() => of(redirectToLogin(auth, router, state.url))),
  );
};
