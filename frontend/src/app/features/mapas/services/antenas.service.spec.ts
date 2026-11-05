import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { AntenasService } from './antenas.service';

describe('AntenasService', () => {
  let service: AntenasService;
  let http: HttpTestingController;

  const antenna = {
    id_antena: 8,
    nombre: 'Torre Norte',
    latitud: '14.6500000',
    longitud: '-90.4800000',
    direccion_sector: null,
    referencia: null,
    foto_antena: null,
    estado: 'Activa',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AntenasService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista antenas desde el endpoint protegido', () => {
    service.getAll().subscribe((antennas) => {
      expect(antennas[0].latitud).toBe(14.65);
      expect(antennas[0].longitud).toBe(-90.48);
    });

    http.expectOne(API_ENDPOINTS.antenas).flush([antenna]);
  });

  it('obtiene y actualiza una antena existente sin alterar datos técnicos', () => {
    service.getById(8).subscribe();
    const detail = http.expectOne(`${API_ENDPOINTS.antenas}/8`);
    expect(detail.request.method).toBe('GET');
    detail.flush(antenna);

    service
      .update(8, {
        direccion_sector: 'Zona 2',
        referencia: null,
        latitud: 14.61,
        longitud: -90.52,
      })
      .subscribe();
    const update = http.expectOne(`${API_ENDPOINTS.antenas}/8`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({
      direccion_sector: 'Zona 2',
      referencia: null,
      latitud: 14.61,
      longitud: -90.52,
    });
    update.flush({ ...antenna, direccion_sector: 'Zona 2' });
  });

  it('registra una antena con coordenadas y fotografía mediante multipart', () => {
    const photo = new File(['foto'], 'sitio.png', { type: 'image/png' });
    service
      .create(
        {
          nombre: 'Torre Sur',
          latitud: 14.61,
          longitud: -90.52,
          direccion_sector: 'Zona 2',
          referencia: null,
          estado: 'Activa',
        },
        photo,
      )
      .subscribe((created) => expect(created.latitud).toBe(14.65));

    const request = http.expectOne(API_ENDPOINTS.antenas);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('nombre')).toBe('Torre Sur');
    expect(body.get('latitud')).toBe('14.61');
    expect(body.get('longitud')).toBe('-90.52');
    expect(body.get('direccion_sector')).toBe('Zona 2');
    expect(body.get('referencia')).toBeNull();
    expect(body.get('estado')).toBe('Activa');
    expect(body.get('foto')).toEqual(expect.objectContaining({ name: 'sitio.png' }));
    request.flush(antenna);
  });

  it('reemplaza y elimina la fotografía de una antena', () => {
    const photo = new File(['foto'], 'antena.png', { type: 'image/png' });
    service.replacePhoto(8, photo).subscribe();
    const replace = http.expectOne(`${API_ENDPOINTS.antenas}/8/foto`);
    expect(replace.request.method).toBe('PUT');
    expect((replace.request.body as FormData).get('foto')).toEqual(
      expect.objectContaining({ name: 'antena.png' }),
    );
    replace.flush({ ...antenna, foto_antena: '/uploads/antenas/antena_8.webp' });

    service.removePhoto(8).subscribe();
    const remove = http.expectOne(`${API_ENDPOINTS.antenas}/8/foto`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(antenna);
  });

  it('elimina el registro de antena sin confundirlo con su fotografía', () => {
    service.delete(8).subscribe();

    const request = http.expectOne(`${API_ENDPOINTS.antenas}/8`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });
});
