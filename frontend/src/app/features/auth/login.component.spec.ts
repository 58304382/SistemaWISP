import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { API_ENDPOINTS } from '../../core/config/api.config';
import { authInterceptor } from '../../core/interceptors/auth.interceptor';
import { LoginComponent } from './login.component';
import { AuthService } from './services/auth.service';

describe('Login: finalización de peticiones y estado de carga', () => {
  let component: LoginComponent;
  let auth: AuthService;
  let http: HttpTestingController;
  const router = { url: '/login', navigateByUrl: vi.fn(), navigate: vi.fn() };
  const usuario = {
    id: 1, nombre: 'Administrador', apellido: 'Prueba', username: 'admin_prueba', activo: true,
    rol_id: 1, rol: { id: 1, nombre: 'Administrador' }, modulos: [], created_at: null, updated_at: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    });
    component = TestBed.createComponent(LoginComponent).componentInstance;
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    auth.clearSession();
    component.form.setValue({ username: 'admin_prueba', password: 'clave-solo-de-prueba' });
  });

  afterEach(() => {
    http.verify();
    auth.clearSession();
    vi.useRealTimers();
  });

  it('termina la carga si /login no responde y permite reintentar', async () => {
    component.submit();
    const solicitud = http.expectOne(API_ENDPOINTS.login);
    expect(component.isLoading()).toBe(true);

    await vi.advanceTimersByTimeAsync(15_001);

    expect(component.isLoading()).toBe(false);
    expect(solicitud.cancelled).toBe(true);
    expect(component.errorMessage()).toContain('tardó demasiado');
    expect(auth.getToken()).toBeNull();
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(component.isLoading()).toBe(false);
  });

  it('termina la carga si /me no responde y descarta la sesión incompleta', async () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({ access_token: 'token-de-prueba', token_type: 'bearer' });
    const solicitud = http.expectOne(API_ENDPOINTS.me);
    expect(solicitud.request.headers.get('Authorization')).toBe('Bearer token-de-prueba');

    await vi.advanceTimersByTimeAsync(15_001);

    expect(component.isLoading()).toBe(false);
    expect(solicitud.cancelled).toBe(true);
    expect(component.errorMessage()).toContain('tardó demasiado');
    expect(auth.getToken()).toBeNull();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('completa el login y redirige solo después de validar /me', () => {
    component.submit();
    const login = http.expectOne(API_ENDPOINTS.login);
    expect(login.request.headers.has('Authorization')).toBe(false);
    login.flush({ access_token: 'token-de-prueba', token_type: 'bearer' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    http.expectOne(API_ENDPOINTS.me).flush(usuario);
    expect(auth.isAdministrator()).toBe(true);
    expect(component.isLoading()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/inicio');
  });

  it('distingue las credenciales incorrectas 401 de un fallo de conexión', () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(component.errorMessage()).toBe('Usuario o contraseña incorrectos.');
    expect(component.isLoading()).toBe(false);

    component.submit();
    http.expectOne(API_ENDPOINTS.login).error(new ProgressEvent('error'));
    expect(component.errorMessage()).toContain('No se pudo conectar con el servidor');
    expect(component.isLoading()).toBe(false);
  });

  it('no expone detalles internos ante un error 500', () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({ detail: 'detalle interno no público' }, { status: 500, statusText: 'Server Error' });
    expect(component.errorMessage()).not.toContain('detalle interno');
    expect(component.isLoading()).toBe(false);
  });

  it('un 403 de /me muestra un error de permisos y no permite entrar', () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({ access_token: 'token-de-prueba', token_type: 'bearer' });
    http.expectOne(API_ENDPOINTS.me).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(component.errorMessage()).toContain('No tienes permisos');
    expect(component.isLoading()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(auth.getToken()).toBeNull();
  });

  it('un 401 de /me no se presenta como contraseña incorrecta', () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({ access_token: 'token-de-prueba', token_type: 'bearer' });
    http.expectOne(API_ENDPOINTS.me).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(component.isLoading()).toBe(false);
    expect(component.errorMessage()).toContain('sesión expiró');
    expect(component.errorMessage()).not.toContain('contraseña incorrectos');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('un 403 de un módulo no cierra una sesión ya validada', () => {
    component.submit();
    http.expectOne(API_ENDPOINTS.login).flush({ access_token: 'token-de-prueba', token_type: 'bearer' });
    http.expectOne(API_ENDPOINTS.me).flush(usuario);
    TestBed.inject(HttpClient).get(API_ENDPOINTS.tiposInstalacionTodos).subscribe({ error: () => undefined });
    http.expectOne(API_ENDPOINTS.tiposInstalacionTodos).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(auth.getToken()).toBe('token-de-prueba');
    expect(auth.isAdministrator()).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('no lanza logins concurrentes al enviar dos veces el formulario', () => {
    component.submit();
    component.submit();
    const solicitudes = http.match(API_ENDPOINTS.login);
    expect(solicitudes).toHaveLength(1);
    for (const solicitud of solicitudes) solicitud.flush({}, { status: 401, statusText: 'Unauthorized' });
  });

  it('un 401 anterior no invalida el token del inicio de sesión recién creado', () => {
    sessionStorage.setItem('sistemawisp_access_token', 'token-anterior');
    TestBed.inject(HttpClient).get(API_ENDPOINTS.me).subscribe({ error: () => undefined });
    const anterior = http.expectOne(API_ENDPOINTS.me);
    expect(anterior.request.headers.get('Authorization')).toBe('Bearer token-anterior');
    sessionStorage.setItem('sistemawisp_access_token', 'token-nuevo');
    router.url = '/inicio';

    anterior.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(auth.getToken()).toBe('token-nuevo');
    expect(router.navigate).not.toHaveBeenCalled();
    router.url = '/login';
  });

  it('no reemplaza al usuario actual con una respuesta de un token anterior', () => {
    sessionStorage.setItem('sistemawisp_access_token', 'token-anterior');
    auth.loadCurrentUser().subscribe({ error: () => undefined });
    const anterior = http.expectOne(API_ENDPOINTS.me);
    sessionStorage.setItem('sistemawisp_access_token', 'token-nuevo');

    anterior.flush(usuario);

    expect(auth.currentUser()).toBeNull();
  });
});
