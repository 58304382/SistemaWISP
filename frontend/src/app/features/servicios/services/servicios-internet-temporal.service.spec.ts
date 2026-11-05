import { TestBed } from '@angular/core/testing';

import { ServicioInternetPayload } from '../models/servicio-internet.models';
import { ServiciosInternetTemporalService } from './servicios-internet-temporal.service';

describe('ServiciosInternetTemporalService', () => {
  let service: ServiciosInternetTemporalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ServiciosInternetTemporalService);
  });

  it('mantiene los registros únicamente en la instancia temporal', () => {
    const payload: ServicioInternetPayload = {
      clienteId: 4,
      planId: 4,
      fechaInicio: '2026-10-30',
      estado: 'Pendiente',
      zona: 'Las Flores',
      descripcion: 'Registro de prueba',
      ipv4: '10.20.4.18',
      mascara: '255.255.255.0',
      gateway: '10.20.4.1',
      dnsPrimario: '8.8.8.8',
      dnsSecundario: '1.1.1.1',
      router: 'edge-flores',
      usuarioRouter: 'operador',
      interfaz: 'eth4',
    };

    const guardado = service.guardar(payload, undefined, true);

    expect(service.listar()[0].id).toBe(guardado.id);
    expect(guardado.cliente).toBe('José Ramírez');
    expect(guardado.edgeConfigurado).toBe(true);
  });

  it('detecta una dirección usada sin consultar una red real', async () => {
    const disponible = await service.simularDisponibilidadIp('10.20.1.18');

    expect(disponible).toBe(false);
  });
});
