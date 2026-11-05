import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../../../core/interceptors/auth.interceptor';
import { AuthService } from '../../auth/services/auth.service';
import { ComprobanteConfiguracionService } from './comprobante-configuracion.service';

describe('ComprobanteConfiguracionService', () => {
  let service: ComprobanteConfiguracionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            getToken: vi.fn().mockReturnValue('jwt-comprobantes'),
            clearSession: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(ComprobanteConfiguracionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta la configuración activa con el JWT global', () => {
    service.getActiva().subscribe();
    const request = http.expectOne(
      'http://127.0.0.1:8000/api/cobros/configuracion-comprobantes/activa',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-comprobantes');
    request.flush({ id_configuracion: 1, version: 1, nombre_comercial: 'Empresa' });
  });

  it('guarda una versión nueva por POST', () => {
    const data = {
      nombre_comercial: 'Empresa',
      descripcion_empresa: 'Internet',
      direccion: 'Zona 1',
      telefono: '2222-2222',
      mensaje_final: 'Gracias',
      nota_fiscal: 'No constituye comprobante fiscal.',
    };

    service.guardar(data).subscribe();
    const request = http.expectOne('http://127.0.0.1:8000/api/cobros/configuracion-comprobantes');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(data);
    request.flush({ id_configuracion: 1, version: 1, ...data });
  });

  it('consulta la última versión guardada', () => {
    service.getUltima().subscribe();
    const request = http.expectOne(
      'http://127.0.0.1:8000/api/cobros/configuracion-comprobantes/ultima',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ id_configuracion: 1, version: 2, nombre_comercial: 'Empresa' });
  });
});
