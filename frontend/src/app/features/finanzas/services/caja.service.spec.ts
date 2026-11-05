import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../../../core/interceptors/auth.interceptor';
import { AuthService } from '../../auth/services/auth.service';
import { MovimientoManualCajaCreate } from '../models/caja.models';
import { CajaService } from './caja.service';

describe('CajaService', () => {
  let service: CajaService;
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
            getToken: vi.fn().mockReturnValue('jwt-caja'),
            clearSession: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(CajaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta conciliación e historial de la sesión y envía una sola entrega autorizada', () => {
    service.conciliacion(12).subscribe();
    const resumen = http.expectOne('http://127.0.0.1:8000/api/caja/sesiones/12/conciliacion');
    expect(resumen.request.method).toBe('GET');
    expect(resumen.request.headers.get('Authorization')).toBe('Bearer jwt-caja');
    resumen.flush({});
    service.listarEntregas(12, 9).subscribe();
    const historial = http.expectOne(r => r.url.endsWith('/api/caja/entregas')
      && r.params.get('id_sesion') === '12' && r.params.get('id_empleado') === '9');
    historial.flush([]);
    service.detalleEntrega(1).subscribe();
    http.expectOne('http://127.0.0.1:8000/api/caja/entregas/1').flush({});
    service.registrarEntrega({ id_sesion: 12, id_empleado: 9, ids_pagos: [10],
      clave_idempotencia: '1bd371a4-6f13-49b0-b103-b9a0e9a3a630', monto_entregado: 80,
      gastos: [{ concepto: 'Gasolina', monto: 20, observaciones: null }],
      autorizar_gastos: true, observaciones: null }).subscribe();
    const entrega = http.expectOne('http://127.0.0.1:8000/api/caja/entregas');
    expect(entrega.request.method).toBe('POST');
    expect(entrega.request.headers.get('Authorization')).toBe('Bearer jwt-caja');
    expect(entrega.request.body.id_administrativo).toBeUndefined();
    expect(entrega.request.body.fecha_hora).toBeUndefined();
    entrega.flush({ id_entrega: 1 });
    http.expectNone('http://127.0.0.1:8000/api/caja/movimientos');
  });

  it('consulta categorías manuales por tipo con el JWT global', () => {
    service.listarCategorias('Ingreso').subscribe();

    const request = http.expectOne(
      (item) =>
        item.url === 'http://127.0.0.1:8000/api/caja/categorias' &&
        item.params.get('tipo') === 'Ingreso',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-caja');
    request.flush([]);
  });

  it('consulta métodos activos desde el endpoint propio de Caja', () => {
    service.listarMetodosPago().subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/caja/metodos-pago');
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('registra únicamente el contrato manual permitido', () => {
    const movimiento: MovimientoManualCajaCreate = {
      tipo: 'Egreso',
      id_categoria: 3,
      concepto: 'Compra operativa',
      monto: 50,
      id_metodo_pago: 2,
      referencia: 'TRX-20',
      observaciones: null,
    };

    service.registrarMovimiento(movimiento).subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/caja/movimientos');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(movimiento);
    expect(request.request.body.id_sesion).toBeUndefined();
    expect(request.request.body.id_responsable).toBeUndefined();
    request.flush({});
  });

  it('envía el cierre de la sesión concreta con JWT sin aceptar responsable ni fecha', () => {
    const data = { monto_contado: 125.5, monto_sistema: 125.5, observaciones: null };
    service.cerrar(12, data).subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/caja/sesiones/12/cierre');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-caja');
    expect(request.request.body).toEqual(data);
    expect(request.request.body.id_empleado).toBeUndefined();
    expect(request.request.body.fecha_cierre).toBeUndefined();
    expect(request.request.body.diferencia).toBeUndefined();
    request.flush({});
  });
});
