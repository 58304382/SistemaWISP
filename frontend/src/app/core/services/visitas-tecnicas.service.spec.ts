import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../config/api.config';
import { VisitaTecnicaCreate } from '../models/visita-tecnica.models';
import { VisitasTecnicasService } from './visitas-tecnicas.service';

describe('VisitasTecnicasService', () => {
  let service: VisitasTecnicasService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VisitasTecnicasService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta los catálogos y el listado en los endpoints reales', () => {
    service.getTiposInstalacion().subscribe();
    http.expectOne(API_ENDPOINTS.tiposInstalacion).flush([]);

    service.getTecnicos().subscribe();
    http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/tecnicos`).flush([]);

    service.getAll().subscribe();
    http.expectOne(API_ENDPOINTS.visitasTecnicas).flush([]);
  });

  it('crea una visita sin foto usando los nombres exactos del formulario FastAPI', () => {
    const data: VisitaTecnicaCreate = {
      id_cliente: 4,
      id_ubicacion: null,
      id_empleado: 7,
      id_tipo_instalacion: 2,
      fecha_programada: '2026-09-21',
      hora_programada: '09:30',
      motivo_visita: 'Evaluar instalación',
      indicaciones: 'Llamar antes',
    };

    service.create(data).subscribe();

    const request = http.expectOne(API_ENDPOINTS.visitasTecnicas);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('id_cliente')).toBe('4');
    expect(body.get('id_ubicacion')).toBeNull();
    expect(body.get('id_empleado')).toBe('7');
    expect(body.get('id_tipo_instalacion')).toBe('2');
    expect(body.get('fecha_programada')).toBe('2026-09-21');
    expect(body.get('hora_programada')).toBe('09:30');
    expect(body.get('motivo_visita')).toBe('Evaluar instalación');
    expect(body.get('indicaciones')).toBe('Llamar antes');
    expect(body.get('observaciones')).toBeNull();
    expect(body.get('foto_referencia')).toBeNull();
    request.flush({});
  });

  it('conserva el archivo original bajo foto_referencia', () => {
    const photo = new File(['image'], 'referencia.png', { type: 'image/png' });
    service
      .create(
        {
          id_cliente: 4,
          id_ubicacion: 18,
          id_empleado: 7,
          id_tipo_instalacion: 2,
          fecha_programada: '2026-09-21',
          hora_programada: '09:30',
          motivo_visita: 'Evaluar instalación',
        },
        photo,
      )
      .subscribe();

    const request = http.expectOne(API_ENDPOINTS.visitasTecnicas);
    const sentPhoto = (request.request.body as FormData).get('foto_referencia');
    expect((request.request.body as FormData).get('id_ubicacion')).toBe('18');
    expect(sentPhoto).toBeInstanceOf(File);
    expect((sentPhoto as File).name).toBe('referencia.png');
    request.flush({});
  });

  it('reutiliza GET, PATCH y DELETE por id para las acciones de gestión', () => {
    service.getById(12).subscribe();
    const getRequest = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/12`);
    expect(getRequest.request.method).toBe('GET');
    getRequest.flush({});

    const update = { motivo_visita: 'Visita reprogramada' };
    service.update(12, update).subscribe();
    const patchRequest = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/12`);
    expect(patchRequest.request.method).toBe('PATCH');
    expect(patchRequest.request.body).toEqual(update);
    patchRequest.flush({});

    service.deleteById(12).subscribe();
    const deleteRequest = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/12`);
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush({});
  });

  it('registra la primera propiedad con fachada en el endpoint atómico de la visita', () => {
    const photo = new File(['image'], 'fachada.png', { type: 'image/png' });

    service
      .registerFirstLocation(
        15,
        {
          direccion: 'Sector Norte',
          referencia: 'Frente al parque',
          observaciones: 'Portón azul',
          latitud: 14.6349142,
          longitud: -90.5068824,
        },
        photo,
      )
      .subscribe();

    const request = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/15/ubicacion`);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('direccion')).toBe('Sector Norte');
    expect(body.get('referencia')).toBe('Frente al parque');
    expect(body.get('observaciones')).toBe('Portón azul');
    expect(body.get('latitud')).toBe('14.6349142');
    expect(body.get('longitud')).toBe('-90.5068824');
    expect(body.get('foto_fachada')).toBeInstanceOf(File);
    expect(body.get('numero_propiedad')).toBeNull();
    request.flush({});
  });

  it('usa id_visita en los endpoints de obtener, iniciar, continuar y finalizar evaluación', () => {
    const payload = {
      descripcion_trabajo: 'Instalar enlace',
      tecnicos_recomendados: 2,
      condiciones_lugar: 'Acceso alto',
      observacion_tecnica: 'Factible',
      materiales: [
        { descripcion: 'Cable UTP', cantidad: 30, unidad: 'Metro' },
        { descripcion: 'Router', cantidad: 1, unidad: 'Unidad' },
      ],
    };

    service.getEvaluation(15).subscribe();
    http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/15/evaluacion`).flush({});

    service.startEvaluation(15, payload).subscribe();
    const start = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/15/evaluacion`);
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual(payload);
    start.flush({});

    service.updateEvaluation(15, { observacion_tecnica: 'Actualizada' }).subscribe();
    const update = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/15/evaluacion`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ observacion_tecnica: 'Actualizada' });
    update.flush({});

    service.finishEvaluation(15, payload).subscribe();
    const finish = http.expectOne(`${API_ENDPOINTS.visitasTecnicas}/15/evaluacion/finalizar`);
    expect(finish.request.method).toBe('POST');
    expect(finish.request.body).toEqual(payload);
    finish.flush({});
  });
});
