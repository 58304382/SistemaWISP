import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CATALOGOS, CatalogoPayload } from '../models/catalogos.models';
import { TiposInstalacionCatalogoService } from './tipos-instalacion-catalogo.service';

describe('Integración HTTP de los seis catálogos', () => {
  let service: TiposInstalacionCatalogoService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TiposInstalacionCatalogoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  for (const config of CATALOGOS) {
    it(`consulta y administra ${config.titulo} con su endpoint e ID reales`, () => {
      const fila = { [config.campoId]: 9, nombre: 'Catálogo', descripcion: null, estado: 'Activo' };
      service.getCatalogo(config.clave).subscribe((items) => expect(items[0].id_tipo_instalacion).toBe(9));
      const listado = http.expectOne(config.listado);
      expect(listado.request.method).toBe('GET');
      listado.flush([fila]);

      const payload: CatalogoPayload = { nombre: 'Catálogo', descripcion: null, estado: 'Activo' };
      if (config.clave === 'caja') payload.tipo = 'Ingreso';
      if (config.clave === 'puestos') payload.tiene_funciones_sistema = false;
      service.guardarCatalogo(config.clave, payload).subscribe((item) => expect(item.id_tipo_instalacion).toBe(9));
      const alta = http.expectOne(config.endpoint);
      expect(alta.request.method).toBe('POST');
      expect(alta.request.body).toEqual(payload);
      expect(alta.request.body.origen_financiero).toBeUndefined();
      alta.flush(fila);

      service.guardarCatalogo(config.clave, { ...payload, estado: 'Inactivo' }, 9).subscribe();
      const cambio = http.expectOne(`${config.endpoint}/9`);
      expect(cambio.request.method).toBe('PATCH');
      expect(cambio.request.body.estado).toBe('Inactivo');
      cambio.flush({ ...fila, estado: 'Inactivo' });
    });
  }
});
