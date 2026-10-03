import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  GuardResult,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';

import { administratorGuard, moduleAccessGuard } from './access.guard';
import { AuthService } from '../services/auth.service';

describe('guards de acceso', () => {
  const user = {
    id: 2,
    nombre: 'Empleado',
    apellido: 'Prueba',
    username: 'empleado',
    rol_id: 2,
    activo: true,
    created_at: null,
    updated_at: null,
    rol: { id: 2, nombre: 'Empleado' },
    modulos: [{ id: 1, nombre: 'Clientes', codigo: 'clientes', activo: true }],
  };

  let auth: {
    currentUser: ReturnType<typeof vi.fn>;
    hasValidSession: ReturnType<typeof vi.fn>;
    ensureCurrentUser: ReturnType<typeof vi.fn>;
    hasModule: ReturnType<typeof vi.fn>;
    isAdministrator: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    auth = {
      currentUser: vi.fn().mockReturnValue(user),
      hasValidSession: vi.fn().mockReturnValue(true),
      ensureCurrentUser: vi.fn().mockReturnValue(of(user)),
      hasModule: vi.fn((moduleCode: string) => moduleCode === 'clientes'),
      isAdministrator: vi.fn().mockReturnValue(false),
      clearSession: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  function runGuard(
    guard: typeof moduleAccessGuard | typeof administratorGuard,
    data: Record<string, unknown> = { module: 'clientes' },
  ) {
    return TestBed.runInInjectionContext(() =>
      guard({ data } as ActivatedRouteSnapshot, { url: '/ruta-protegida' } as RouterStateSnapshot),
    );
  }

  async function resolveGuard(result: ReturnType<typeof runGuard>): Promise<GuardResult> {
    return result instanceof Observable ? firstValueFrom(result) : result;
  }

  it('permite un módulo asignado y activo', async () => {
    await expect(resolveGuard(runGuard(moduleAccessGuard))).resolves.toBe(true);
  });

  it('redirige a Inicio si falta el módulo', async () => {
    auth.hasModule.mockReturnValue(false);
    const result = await resolveGuard(runGuard(moduleAccessGuard));

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/inicio');
  });

  it('permite solo al Administrador la ruta administrativa', async () => {
    const employeeResult = await resolveGuard(runGuard(administratorGuard));
    expect(TestBed.inject(Router).serializeUrl(employeeResult as UrlTree)).toBe('/inicio');

    auth.isAdministrator.mockReturnValue(true);
    await expect(resolveGuard(runGuard(administratorGuard))).resolves.toBe(true);
  });

  it('redirige al login cuando no existe una sesión válida', () => {
    auth.hasValidSession.mockReturnValue(false);
    const result = runGuard(moduleAccessGuard);

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/login?returnUrl=%2Fruta-protegida',
    );
    expect(auth.clearSession).toHaveBeenCalled();
  });
});
