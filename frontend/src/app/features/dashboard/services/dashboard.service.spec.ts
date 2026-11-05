import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../../../core/interceptors/auth.interceptor';
import { AuthService } from '../../auth/services/auth.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
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
            getToken: vi.fn().mockReturnValue('jwt-dashboard'),
            clearSession: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(DashboardService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consume los cuatro endpoints del Dashboard con JWT', () => {
    const filtro = { periodo: 'mes' as const };
    service.obtenerResumen(filtro).subscribe();
    let request = http.expectOne('http://127.0.0.1:8000/api/dashboard/resumen?periodo=mes');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-dashboard');
    request.flush({});

    service.obtenerFinanciero(filtro).subscribe();
    request = http.expectOne(
      'http://127.0.0.1:8000/api/dashboard/financiero?periodo=mes',
    );
    expect(request.request.method).toBe('GET');
    request.flush({});

    service.obtenerComercial(filtro).subscribe();
    request = http.expectOne(
      'http://127.0.0.1:8000/api/dashboard/comercial?periodo=mes',
    );
    expect(request.request.method).toBe('GET');
    request.flush({});

    service.obtenerOperativo(filtro).subscribe();
    request = http.expectOne(
      'http://127.0.0.1:8000/api/dashboard/operativo?periodo=mes',
    );
    expect(request.request.method).toBe('GET');
    request.flush({});
  });

  it('envía fechas solo cuando el período es personalizado', () => {
    service
      .obtenerResumen({
        periodo: 'personalizado',
        fecha_inicio: '2026-10-01',
        fecha_fin: '2026-10-31',
      })
      .subscribe();

    const request = http.expectOne(
      (item) => item.url === 'http://127.0.0.1:8000/api/dashboard/resumen',
    );
    expect(request.request.params.get('periodo')).toBe('personalizado');
    expect(request.request.params.get('fecha_inicio')).toBe('2026-10-01');
    expect(request.request.params.get('fecha_fin')).toBe('2026-10-31');
    request.flush({});
  });

  it('reutiliza el reporte oficial de Caja General para el resumen financiero', () => {
    service.obtenerResumenCaja('semana', '2026-11-04').subscribe();

    const request = http.expectOne(
      'http://127.0.0.1:8000/api/caja/reporte?periodo=semanal&fecha=2026-11-04',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-dashboard');
    request.flush({});
  });

  it('omite fechas heredadas en los períodos predefinidos', () => {
    service
      .obtenerOperativo({
        periodo: 'semana',
        fecha_inicio: '2026-10-01',
        fecha_fin: '2026-10-31',
      })
      .subscribe();

    const request = http.expectOne(
      'http://127.0.0.1:8000/api/dashboard/operativo?periodo=semana',
    );
    expect(request.request.params.has('fecha_inicio')).toBe(false);
    expect(request.request.params.has('fecha_fin')).toBe(false);
    request.flush({});
  });
});
