import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../config/api.config';
import { UbicacionesClienteService } from './ubicaciones-cliente.service';

describe('UbicacionesClienteService', () => {
  let service: UbicacionesClienteService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UbicacionesClienteService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reutiliza el endpoint de propiedades del cliente', () => {
    service.getByClient(4).subscribe();

    const request = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/cliente/4`);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('consulta el listado global protegido para Mapas', () => {
    service.getAll().subscribe();

    const request = http.expectOne(API_ENDPOINTS.ubicacionesCliente);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });
});
