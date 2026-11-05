import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { TicketWrite } from '../models/ticket.models';
import { TicketsService } from './tickets.service';

/** Verifica contratos HTTP sin red ni cambios en PostgreSQL. */
describe('TicketsService', () => {
  let service: TicketsService;
  let http: HttpTestingController;
  const url = `${API_BASE_URL}/api/tickets`;
  const payload: TicketWrite = { id_cliente: 1, id_categoria: 2, id_tecnico: 3, canal: 'Presencial', asunto: 'Asunto', descripcion: 'Descripción', observaciones: null };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TicketsService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('envía filtros como parámetros HTTP y preserva el texto buscado', () => {
    service.getAll({ buscar: 'cámara & red', estado: 'Programada', id_categoria: 2, id_tecnico: 3 }).subscribe();
    const request = http.expectOne((req) => req.url === url);
    expect(request.request.params.get('buscar')).toBe('cámara & red');
    expect(request.request.params.get('estado')).toBe('Programada');
    expect(request.request.params.get('id_categoria')).toBe('2');
    expect(request.request.params.get('id_tecnico')).toBe('3');
    request.flush([]);
  });

  it('consulta los selectores protegidos de soporte', () => {
    service.getCategorias().subscribe(); service.getClientes().subscribe(); service.getTecnicos().subscribe();
    for (const path of ['categorias', 'clientes', 'tecnicos']) { const request = http.expectOne(`${url}/${path}`); expect(request.request.method).toBe('GET'); request.flush([]); }
  });

  it('registra, consulta, edita y elimina mediante el contrato existente del módulo', () => {
    service.create(payload).subscribe(); let request = http.expectOne(url); expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual(payload); request.flush({});
    service.getById(8).subscribe(); request = http.expectOne(`${url}/8`); expect(request.request.method).toBe('GET'); request.flush({});
    service.update(8, payload).subscribe(); request = http.expectOne(`${url}/8`); expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual(payload); request.flush({});
    service.delete(8).subscribe(); request = http.expectOne(`${url}/8`); expect(request.request.method).toBe('DELETE'); request.flush(null, { status: 204, statusText: 'No Content' });
  });

  /** La identidad se obtiene en FastAPI: el multipart solo contiene informe y archivo. */
  it('inicia y finaliza con evidencia obligatoria sin enviar técnico ni estado', () => {
    service.start(8).subscribe();
    let request = http.expectOne(`${url}/8/iniciar`);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({}); request.flush({});
    const photo = new File(['imagen de prueba'], 'foto.png', { type: 'image/png' });
    service.complete(8, { trabajo_realizado: 'Trabajo', resultado_solucion: 'Solución', observaciones: null }, photo).subscribe();
    request = http.expectOne(`${url}/8/finalizar`);
    const data = request.request.body as FormData;
    expect(data.get('trabajo_realizado')).toBe('Trabajo'); expect(data.get('resultado_solucion')).toBe('Solución');
    expect(data.get('evidencia')).toBe(photo); expect(data.has('id_tecnico')).toBe(false); expect(data.has('estado')).toBe(false);
    expect(data.has('observaciones')).toBe(false); request.flush({});
  });
});
