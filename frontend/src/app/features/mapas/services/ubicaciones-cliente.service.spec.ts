import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../../../core/config/api.config';
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

  it('consulta una propiedad específica para los flujos contextuales', () => {
    service.getById(12).subscribe((location) => expect(location.id_ubicacion).toBe(12));

    const request = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/12`);
    expect(request.request.method).toBe('GET');
    request.flush({
      id_ubicacion: 12,
      id_cliente: 3,
      numero_propiedad: 2,
      nombre_cliente: 'Cliente',
      direccion: 'Sector Sur',
      latitud: '14.6100000',
      longitud: '-90.5200000',
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-09T10:00:00',
    });
  });

  it('consulta el listado global protegido para Mapas', () => {
    service.getAll().subscribe((locations) => {
      expect(locations[0].latitud).toBe(14.6349);
      expect(locations[0].longitud).toBe(-90.5068);
      expect(locations[1].latitud).toBeNull();
      expect(locations[1].longitud).toBeNull();
    });

    const request = http.expectOne(API_ENDPOINTS.ubicacionesCliente);
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id_ubicacion: 1,
        id_cliente: 2,
        numero_propiedad: 1,
        nombre_cliente: 'Cliente',
        direccion: null,
        latitud: '14.6349000',
        longitud: '-90.5068000',
        foto_fachada: null,
        referencia: null,
        observaciones: null,
        estado: 'Activo',
        fecha_registro: '2026-10-07T10:00:00',
      },
      {
        id_ubicacion: 2,
        id_cliente: 2,
        numero_propiedad: 2,
        nombre_cliente: 'Cliente',
        direccion: null,
        latitud: null,
        longitud: null,
        foto_fachada: null,
        referencia: null,
        observaciones: null,
        estado: 'Activo',
        fecha_registro: '2026-10-07T10:00:00',
      },
    ]);
  });

  it('envía el enlace al endpoint real y devuelve sus coordenadas sin guardar', () => {
    const enlace = 'https://maps.app.goo.gl/aiYZUsrRzUrRnzqWA?g_st=aw';
    service.resolveGoogleMapsLink(enlace).subscribe((coordinates) => {
      expect(coordinates).toEqual({ latitud: 14.743296, longitud: -91.132924 });
    });

    const request = http.expectOne(
      `${API_ENDPOINTS.ubicacionesCliente}/resolver-enlace-google-maps`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ enlace });
    request.flush({ latitud: 14.743296, longitud: -91.132924 });
  });

  it('crea una propiedad sin enviar numeración y conserva coordenadas opcionales', () => {
    const photo = new File(['fachada'], 'fachada.png', { type: 'image/png' });
    service
      .create(
        {
          id_cliente: 4,
          direccion: 'Zona 1',
          referencia: null,
          observaciones: 'Portón negro',
          latitud: null,
          longitud: null,
          estado: 'Activo',
        },
        photo,
      )
      .subscribe();

    const request = http.expectOne(API_ENDPOINTS.ubicacionesCliente);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('id_cliente')).toBe('4');
    expect(body.get('direccion')).toBe('Zona 1');
    expect(body.get('observaciones')).toBe('Portón negro');
    expect(body.get('latitud')).toBeNull();
    expect(body.get('longitud')).toBeNull();
    expect(body.get('numero_propiedad')).toBeNull();
    expect(body.get('foto')).toEqual(expect.objectContaining({ name: 'fachada.png' }));
    request.flush({
      id_ubicacion: 3,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'Cliente',
      direccion: 'Zona 1',
      latitud: null,
      longitud: null,
      foto_fachada: null,
      referencia: null,
      observaciones: 'Portón negro',
      estado: 'Activo',
      fecha_registro: '2026-10-07T10:00:00',
    });
  });

  it('actualiza datos y administra la fachada con los endpoints existentes', () => {
    service
      .update(3, {
        direccion: null,
        referencia: null,
        observaciones: null,
        latitud: 14.6,
        longitud: -90.5,
        estado: 'Inactivo',
      })
      .subscribe();
    const update = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/3`);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({
      direccion: null,
      referencia: null,
      observaciones: null,
      latitud: 14.6,
      longitud: -90.5,
      estado: 'Inactivo',
    });
    update.flush({
      id_ubicacion: 3,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'Cliente',
      direccion: null,
      latitud: '14.6000000',
      longitud: '-90.5000000',
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Inactivo',
      fecha_registro: '2026-10-07T10:00:00',
    });

    const photo = new File(['foto'], 'nueva.webp', { type: 'image/webp' });
    service.replacePhoto(3, photo).subscribe();
    const replace = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/3/foto`);
    expect(replace.request.method).toBe('PUT');
    expect((replace.request.body as FormData).get('foto')).toEqual(
      expect.objectContaining({ name: 'nueva.webp' }),
    );
    replace.flush({
      id_ubicacion: 3,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'Cliente',
      direccion: null,
      latitud: '14.6000000',
      longitud: '-90.5000000',
      foto_fachada: '/uploads/ubicaciones_clientes/nueva.webp',
      referencia: null,
      observaciones: null,
      estado: 'Inactivo',
      fecha_registro: '2026-10-07T10:00:00',
    });

    service.removePhoto(3).subscribe();
    const remove = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/3/foto`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush({
      id_ubicacion: 3,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'Cliente',
      direccion: null,
      latitud: '14.6000000',
      longitud: '-90.5000000',
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Inactivo',
      fecha_registro: '2026-10-07T10:00:00',
    });
  });

  it('elimina únicamente el registro de la propiedad seleccionada', () => {
    service.delete(12).subscribe();

    const request = http.expectOne(`${API_ENDPOINTS.ubicacionesCliente}/12`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });
});
