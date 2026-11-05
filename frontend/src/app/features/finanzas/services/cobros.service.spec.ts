import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { authInterceptor } from '../../../core/interceptors/auth.interceptor';
import { AuthService } from '../../auth/services/auth.service';
import { RegistroPagoCreate } from '../models/cobros.models';
import { CobrosService } from './cobros.service';

describe('CobrosService', () => {
  let service: CobrosService;
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
            getToken: vi.fn().mockReturnValue('jwt-cobros'),
            clearSession: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(CobrosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta cobros paginados y métodos con el JWT global', () => {
    service.listar(2, 25).subscribe();
    const cobros = http.expectOne(
      (request) =>
        request.url === 'http://127.0.0.1:8000/api/cobros' &&
        request.params.get('page') === '2' &&
        request.params.get('page_size') === '25',
    );
    expect(cobros.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    cobros.flush({ items: [], total: 0, page: 2, page_size: 25, total_pages: 0 });

    service.listarMetodosPago().subscribe();
    const metodos = http.expectOne('http://127.0.0.1:8000/api/cobros/metodos-pago');
    expect(metodos.request.method).toBe('GET');
    metodos.flush([]);
  });

  it('registra únicamente el contrato financiero permitido', () => {
    const pago: RegistroPagoCreate = {
      id_cliente: 4,
      origen_financiero: 'INSTALACIONES',
      clave_idempotencia: '6f51984f-e46b-4428-94a6-41ff3db37852',
      id_metodo_pago: 1,
      monto_total: 100,
      referencia: null,
      observaciones: null,
      aplicaciones: [{ id_cobro: 8, concepto: 'Instalación', monto_aplicado: 100 }],
    };
    service.registrarPago(pago).subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/cobros/pagos');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(pago);
    expect(request.request.body.id_empleado).toBeUndefined();
    expect(request.request.body.fecha).toBeUndefined();
    request.flush({});
  });

  it('distribuye un anticipo sin crear otro endpoint ni movimiento', () => {
    const distribucion = {
      aplicaciones: [{ id_cobro: 9, concepto: null, monto_aplicado: 50 }],
    };
    service.distribuirPago(31, distribucion).subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/cobros/pagos/31/aplicaciones');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(distribucion);
    request.flush({});
  });

  it('registra la obligación pendiente con JWT sin utilizar el endpoint de pagos', () => {
    service
      .registrarPendiente({
        id_cliente: 4,
        origen_financiero: 'ORDENES_TRABAJO',
        id_cotizacion: 8,
        tipo_pago: 'PENDIENTE',
        monto_total: 0,
      })
      .subscribe();
    const request = http.expectOne('http://127.0.0.1:8000/api/cobros/obligaciones-pendientes');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    expect(request.request.body.monto_total).toBe(0);
    expect(request.request.body.id_metodo_pago).toBeUndefined();
    expect(request.request.body.aplicaciones).toBeUndefined();
    http.expectNone('http://127.0.0.1:8000/api/cobros/pagos');
    request.flush({});
  });

  it('consulta anticipos paginados por cliente y origen obligatorios', () => {
    service.listarAnticipos(4, 'INSTALACIONES', 2, 25).subscribe();

    const request = http.expectOne(
      (candidate) =>
        candidate.url === 'http://127.0.0.1:8000/api/cobros/pagos' &&
        candidate.params.get('id_cliente') === '4' &&
        candidate.params.get('origen_financiero') === 'INSTALACIONES' &&
        candidate.params.get('page') === '2' &&
        candidate.params.get('page_size') === '25',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], total: 0, page: 2, page_size: 25, total_pages: 0 });
  });

  it('consulta comprobantes del historial y descarga su PDF con JWT', () => {
    service.listarComprobantes(8, 1, 50).subscribe();
    const historial = http.expectOne(
      (candidate) =>
        candidate.url === 'http://127.0.0.1:8000/api/cobros/comprobantes' &&
        candidate.params.get('id_cobro') === '8' &&
        candidate.params.get('page') === '1' &&
        candidate.params.get('page_size') === '50',
    );
    expect(historial.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    historial.flush({ items: [], total: 0, page: 1, page_size: 50, total_pages: 0 });

    service.descargarComprobantePdf(41).subscribe();
    const pdf = http.expectOne('http://127.0.0.1:8000/api/cobros/comprobantes/41/pdf');
    expect(pdf.request.method).toBe('GET');
    expect(pdf.request.responseType).toBe('blob');
    expect(pdf.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    pdf.flush(new Blob(['%PDF-1.4']));
  });

  it('descarga la copia térmica actual sin pedir el PDF histórico', () => {
    service.descargarComprobantePdfTermico(41).subscribe();
    const copia = http.expectOne('http://127.0.0.1:8000/api/cobros/comprobantes/41/pdf-termico');
    expect(copia.request.method).toBe('GET');
    expect(copia.request.responseType).toBe('blob');
    expect(copia.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    http.expectNone('http://127.0.0.1:8000/api/cobros/comprobantes/41/pdf');
    copia.flush(new Blob(['%PDF-1.4']));
  });

  it('consulta los datos del documento existente mediante GET autenticado', () => {
    service.consultarComprobante(41).subscribe();
    const consulta = http.expectOne('http://127.0.0.1:8000/api/cobros/comprobantes/41');
    expect(consulta.request.method).toBe('GET');
    expect(consulta.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    consulta.flush({ id_comprobante: 41, numero: 'COB-000001', conceptos: [] });
    http.expectNone((request) => request.method === 'POST');
  });

  it('consulta los clientes activos desde el permiso de Cobros', () => {
    service.listarClientesActivos().subscribe();

    const clientes = http.expectOne('http://127.0.0.1:8000/api/cobros/clientes');
    expect(clientes.request.method).toBe('GET');
    expect(clientes.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    clientes.flush([]);
  });

  it('consulta receptores activos sin requerir acceso administrativo a Empleados', () => {
    service.listarEmpleadosReceptores().subscribe();
    const consulta = http.expectOne('http://127.0.0.1:8000/api/cobros/empleados-receptores');
    expect(consulta.request.method).toBe('GET');
    expect(consulta.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    consulta.flush([{ id_empleado: 9, codigo: 'COB-009', nombres: 'Cobrador', apellidos: 'Real' }]);
  });

  it('consulta servicios y actualiza únicamente su día de vencimiento', () => {
    service.listarServiciosInternet().subscribe();
    const listado = http.expectOne('http://127.0.0.1:8000/api/cobros/internet/servicios');
    expect(listado.request.method).toBe('GET');
    expect(listado.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    listado.flush([]);

    service.actualizarDiaVencimiento(8, { dia_vencimiento: 15 }).subscribe();
    const actualizacion = http.expectOne(
      'http://127.0.0.1:8000/api/cobros/internet/servicios/8/dia-vencimiento',
    );
    expect(actualizacion.request.method).toBe('PATCH');
    expect(actualizacion.request.body).toEqual({ dia_vencimiento: 15 });
    expect(actualizacion.request.body.costo_mensual).toBeUndefined();
    actualizacion.flush({});
  });

  it('genera manualmente las mensualidades del mes y año seleccionados', () => {
    service.generarMensualidadesInternet({ mes: 2, anio: 2028 }).subscribe();

    const request = http.expectOne('http://127.0.0.1:8000/api/cobros/internet/mensualidades');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    expect(request.request.body).toEqual({ mes: 2, anio: 2028 });
    request.flush({ periodo: '2028-02', generadas: 1, existentes: 0, total_elegibles: 1 });
  });

  it('consulta las cotizaciones válidas de órdenes del cliente', () => {
    service.listarCotizacionesOrden(6).subscribe();

    const cotizaciones = http.expectOne(
      (candidate) =>
        candidate.url === 'http://127.0.0.1:8000/api/cobros/ordenes-trabajo/cotizaciones' &&
        candidate.params.get('id_cliente') === '6',
    );
    expect(cotizaciones.request.method).toBe('GET');
    expect(cotizaciones.request.headers.get('Authorization')).toBe('Bearer jwt-cobros');
    cotizaciones.flush([]);
  });
});
