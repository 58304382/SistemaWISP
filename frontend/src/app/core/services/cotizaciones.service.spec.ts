import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../interceptors/auth.interceptor';
import { AuthService } from './auth.service';
import { CotizacionesService } from './cotizaciones.service';

describe('CotizacionesService', () => {
  let service: CotizacionesService;
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
            getToken: vi.fn().mockReturnValue('jwt-prueba'),
            clearSession: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(CotizacionesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista cotizaciones con JWT agregado por el interceptor', () => {
    service.list().subscribe();
    const request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-prueba');
    request.flush([]);
  });

  it('consulta y edita una cotización por ID', () => {
    service.getById(8).subscribe();
    http.expectOne('http://127.0.0.1:8000/api/cotizaciones/8').flush({});

    const payload = { porcentaje_descuento: 5 };
    service.update(8, payload).subscribe();
    const request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones/8');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(payload);
    request.flush({});
  });

  it('crea DIRECTA y desde EVALUACION con sus DTOs exactos', () => {
    const directa = {
      id_cliente: 2,
      porcentaje_descuento: 0,
      detalles: [{ descripcion: 'Servicio', cantidad: 1, unidad: null, precio_unitario: 100 }],
    };
    service.createDirect(directa).subscribe();
    let request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones');
    expect(request.request.body).toEqual(directa);
    request.flush({});

    const evaluacion = { id_evaluacion: 4, porcentaje_descuento: 0 };
    service.createFromEvaluation(evaluacion).subscribe();
    request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones/desde-evaluacion');
    expect(request.request.body).toEqual(evaluacion);
    request.flush({});
  });

  it('usa endpoints explícitos para generar, aceptar y rechazar', () => {
    const acciones = [
      [service.generate(3), '/generar'],
      [service.accept(3), '/aceptar'],
      [service.reject(3), '/rechazar'],
    ] as const;
    for (const [request$, suffix] of acciones) {
      request$.subscribe();
      const request = http.expectOne(`http://127.0.0.1:8000/api/cotizaciones/3${suffix}`);
      expect(request.request.method).toBe('POST');
      request.flush({});
    }
  });

  it('elimina y opera Proformas mediante las rutas reales', () => {
    service.delete(5).subscribe();
    let request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones/5');
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    service.generateProforma(5).subscribe();
    request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones/5/proforma');
    expect(request.request.method).toBe('POST');
    request.flush({});

    service.getProformaByQuotation(5).subscribe();
    request = http.expectOne('http://127.0.0.1:8000/api/cotizaciones/5/proforma');
    expect(request.request.method).toBe('GET');
    request.flush({});

    service.getProformaById(9).subscribe();
    request = http.expectOne('http://127.0.0.1:8000/api/proformas/9');
    expect(request.request.method).toBe('GET');
    request.flush({});
  });
});
