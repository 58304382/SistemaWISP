import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../config/api.config';
import { UsuarioCreate } from '../models/usuario.models';
import { UsuariosService } from './usuarios.service';

describe('UsuariosService', () => {
  let service: UsuariosService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsuariosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el catálogo autoritativo de empleados disponibles', () => {
    service.getAvailableEmployees().subscribe();

    const request = http.expectOne(API_ENDPOINTS.empleadosDisponiblesUsuario);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('crea la cuenta con id_empleado y sin duplicar nombre ni apellido', () => {
    const payload: UsuarioCreate = {
      id_empleado: 7,
      username: 'jluis',
      password: 'password123',
      rol_id: 2,
      activo: true,
      modulo_ids: [1, 3],
    };

    service.create(payload).subscribe();

    const request = http.expectOne(API_ENDPOINTS.usuarios);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    expect(request.request.body).not.toHaveProperty('nombre');
    expect(request.request.body).not.toHaveProperty('apellido');
    request.flush({});
  });
});
