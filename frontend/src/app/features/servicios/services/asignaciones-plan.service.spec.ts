import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { AsignacionPlanPayload } from '../models/asignacion-plan.models';
import { AsignacionesPlanService } from './asignaciones-plan.service';

describe('AsignacionesPlanService', () => {
  let service: AsignacionesPlanService;
  let http: HttpTestingController;
  const payload: AsignacionPlanPayload = {
    id_cliente: 4,
    id_plan: 2,
    fecha_inicio: '2026-10-25',
    estado: 'Activo',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AsignacionesPlanService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta listado, detalle y catálogos del módulo Servicios', () => {
    service.getAll('Activo').subscribe();
    let request = http.expectOne((candidate) => candidate.url === API_ENDPOINTS.asignacionesPlanes);
    expect(request.request.params.get('estado')).toBe('Activo');
    request.flush([]);

    service.getById(7).subscribe();
    request = http.expectOne(`${API_ENDPOINTS.asignacionesPlanes}/7`);
    request.flush({});

    service.getClientes().subscribe();
    request = http.expectOne(`${API_ENDPOINTS.asignacionesPlanes}/catalogos/clientes`);
    request.flush([]);

    service.getPlanes().subscribe();
    request = http.expectOne(`${API_ENDPOINTS.asignacionesPlanes}/catalogos/planes`);
    request.flush([]);
  });

  it('crea y edita sin enviar costo mensual', () => {
    service.create(payload).subscribe();
    let request = http.expectOne(API_ENDPOINTS.asignacionesPlanes);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    expect(request.request.body.costo_mensual).toBeUndefined();
    request.flush({});

    service.update(9, payload).subscribe();
    request = http.expectOne(`${API_ENDPOINTS.asignacionesPlanes}/9`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(payload);
    request.flush({});

    service.delete(9).subscribe();
    request = http.expectOne(`${API_ENDPOINTS.asignacionesPlanes}/9`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });
});
