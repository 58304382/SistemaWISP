import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../features/auth/services/auth.service';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let allowedModules: Set<string>;

  beforeEach(async () => {
    allowedModules = new Set();
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: vi.fn().mockReturnValue({
              nombre: 'Ana',
              apellido: 'López',
              username: 'alopez',
            }),
            hasModule: (code: string) => allowedModules.has(code),
            isAdministrator: vi.fn().mockReturnValue(false),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
  });

  it('muestra Mapas únicamente con el permiso mapas', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/mapas"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('mapas');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/mapas"]')?.textContent).toContain('Mapas');
  });

  // Soporte respeta el mismo catálogo de permisos que su ruta y su API.
  it('muestra Soporte Técnico únicamente con el permiso tickets', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/soporte-tecnico"]')).toBeNull();
    fixture.destroy();
    allowedModules.add('tickets');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/soporte-tecnico"]')?.textContent,
    ).toContain('Soporte Técnico');
  });

  it('muestra Finanzas con el permiso padre o una categoría de Cobros', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/finanzas"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('pagos');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/finanzas"]')?.textContent).toContain(
      'Finanzas',
    );

    fixture.destroy();
    allowedModules.clear();
    allowedModules.add('administrar_vencimientos_internet');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('a[href="/finanzas/cobros"]')?.textContent,
    ).toContain('Finanzas');
  });

  // Servicios deja de ser una opción pendiente únicamente para cuentas autorizadas.
  it('muestra Servicios únicamente con el permiso servicios', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/servicios"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('servicios');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/servicios"]')?.textContent).toContain(
      'Servicios',
    );
  });

  it('muestra Proveedores únicamente con el permiso proveedores', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/proveedores"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('proveedores');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/proveedores"]')?.textContent).toContain(
      'Proveedores',
    );
  });

  it('permite expandir y contraer el menú compacto de tablet', () => {
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.tablet-toggle-button');

    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.tabletExpanded()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fixture.componentInstance.collapseTablet();
    fixture.detectChanges();
    expect(fixture.componentInstance.tabletExpanded()).toBe(false);
  });

  it('muestra Dashboard con el permiso dashboard o para el Administrador', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/dashboard"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('dashboard');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/dashboard"]')?.textContent).toContain(
      'Dashboard',
    );

    fixture.destroy();
    allowedModules.clear();
    const auth = TestBed.inject(AuthService) as unknown as {
      isAdministrator: ReturnType<typeof vi.fn>;
    };
    auth.isAdministrator.mockReturnValue(true);
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/dashboard"]')?.textContent).toContain(
      'Dashboard',
    );
  });
});
