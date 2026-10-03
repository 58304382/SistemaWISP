import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../config/api.config';
import { InstalacionCreate } from '../models/instalacion.models';
import { InstalacionesService } from './instalaciones.service';

describe('InstalacionesService', () => {
  let service: InstalacionesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InstalacionesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('crea y edita instalaciones con el equipo técnico real', () => {
    const data: InstalacionCreate = {
      id_cliente: 4,
      fecha_programada: '2026-09-21',
      hora_programada: '09:30',
      observaciones: null,
      tecnicos: [
        { id_empleado: 7, es_encargado: true },
        { id_empleado: 8, es_encargado: false },
      ],
    };

    service.create(data).subscribe();
    const create = http.expectOne(API_ENDPOINTS.instalaciones);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(data);
    create.flush({});

    service.update(3, { tecnicos: data.tecnicos }).subscribe();
    const update = http.expectOne(`${API_ENDPOINTS.instalaciones}/3`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ tecnicos: data.tecnicos });
    update.flush({});
  });

  it('usa las rutas actuales para iniciar, completar y eliminar', () => {
    service.start(3).subscribe();
    const start = http.expectOne(`${API_ENDPOINTS.instalaciones}/3/iniciar`);
    expect(start.request.method).toBe('POST');
    start.flush({});

    const evidence = new File(['image'], 'evidencia.png', { type: 'image/png' });
    service.complete(3, 'Trabajo terminado', evidence).subscribe();
    const complete = http.expectOne(`${API_ENDPOINTS.instalaciones}/3/completar`);
    expect(complete.request.method).toBe('POST');
    const completeBody = complete.request.body as FormData;
    expect(completeBody.get('observaciones_tecnicas')).toBe('Trabajo terminado');
    const sentEvidence = completeBody.get('evidencia') as File;
    expect(sentEvidence.name).toBe('evidencia.png');
    expect(sentEvidence.type).toBe('image/png');
    complete.flush({});

    service.delete(3).subscribe();
    const deletion = http.expectOne(`${API_ENDPOINTS.instalaciones}/3`);
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush({});
  });
});
