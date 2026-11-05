import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { TareasService } from './tareas.service';

describe('TareasService', () => {
  it('normaliza las coordenadas de propiedades antes de exponerlas al mapa', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(TareasService);
    const http = TestBed.inject(HttpTestingController);

    service.getAll().subscribe((tasks) => {
      expect(tasks[0].latitud).toBe(14.6349142);
      expect(tasks[0].longitud).toBe(-90.5068824);
    });

    http.expectOne(API_ENDPOINTS.tareas).flush([
      {
        id: 1,
        tipo: 'Visita Técnica',
        id_visita: 1,
        id_instalacion: null,
        id_cliente: 2,
        id_ubicacion: 3,
        numero_propiedad: 1,
        direccion_propiedad: 'Sector Norte',
        referencia_propiedad: null,
        foto_fachada: null,
        latitud: '14.6349142',
        longitud: '-90.5068824',
        cliente: 'Cliente',
        fecha: '2026-10-07',
        hora: '10:00:00',
        descripcion: null,
        estado: 'Programada',
        id_tipo_instalacion: 1,
        tipo_instalacion: 'Internet',
        tecnicos: [],
        ubicacion_disponible: true,
        puede_ver: true,
        puede_realizar_acciones: true,
        es_responsable: true,
        bloqueada: false,
      },
    ]);
    http.verify();
  });
});
