import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { filter, firstValueFrom, of } from 'rxjs';

import { AuthService } from '../core/services/auth.service';
import { UsuariosService } from '../core/services/usuarios.service';
import { InicioComponent } from './inicio/inicio.component';
import { UsuariosComponent } from './usuarios/usuarios.component';

describe('Navegación del sidebar', () => {
  let router: Router;
  let usuariosFixture: ComponentFixture<UsuariosComponent>;

  const user = {
    id: 1,
    nombre: 'Admin',
    apellido: 'User',
    username: 'admin',
    rol_id: 1,
    activo: true,
    created_at: null,
    updated_at: null,
    rol: { id: 1, nombre: 'Administrador' },
    modulos: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InicioComponent, UsuariosComponent],
      providers: [
        provideRouter([
          { path: 'inicio', component: InicioComponent },
          { path: 'usuarios', component: UsuariosComponent },
        ]),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(user),
            hasValidSession: vi.fn().mockReturnValue(true),
            loadCurrentUser: vi.fn(),
            logout: vi.fn(),
          },
        },
        {
          provide: UsuariosService,
          useValue: {
            getAll: vi.fn().mockReturnValue(of([])),
            getModules: vi.fn().mockReturnValue(of([])),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    usuariosFixture = TestBed.createComponent(UsuariosComponent);
    usuariosFixture.detectChanges();
  });

  it('navega de Usuarios a Inicio al hacer clic en el enlace', async () => {
    await router.navigateByUrl('/usuarios');
    usuariosFixture.detectChanges();
    const inicioLink = usuariosFixture.nativeElement.querySelector(
      'a[routerLink="/inicio"]',
    ) as HTMLAnchorElement;
    const navigation = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );

    inicioLink.click();
    await navigation;

    expect(router.url).toBe('/inicio');
  });

  it('navega de Inicio a Usuarios al hacer clic en el enlace', async () => {
    const inicioFixture = TestBed.createComponent(InicioComponent);
    inicioFixture.detectChanges();
    const usuariosLink = inicioFixture.nativeElement.querySelector(
      'a[routerLink="/usuarios"]',
    ) as HTMLAnchorElement;
    const navigation = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd)),
    );

    usuariosLink.click();
    await navigation;

    expect(router.url).toBe('/usuarios');
  });
});
