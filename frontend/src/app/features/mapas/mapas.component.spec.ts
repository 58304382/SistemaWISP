import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { Antena } from '../../core/models/antena.models';
import { UbicacionCliente } from '../../core/models/ubicacion-cliente.models';
import { AntenasService } from '../../core/services/antenas.service';
import { GoogleMapsLoaderService } from '../../core/services/google-maps-loader.service';
import { UbicacionesClienteService } from '../../core/services/ubicaciones-cliente.service';
import { MapasComponent } from './mapas.component';

describe('MapasComponent', () => {
  let fixture: ComponentFixture<MapasComponent>;
  let component: MapasComponent;
  let locationsService: { getAll: ReturnType<typeof vi.fn> };
  let antennasService: { getAll: ReturnType<typeof vi.fn> };
  let loader: { load: ReturnType<typeof vi.fn> };
  let markerCalls: Array<{ title: string; content?: Node }>;
  let markerHandlers: Array<() => void>;

  const properties: UbicacionCliente[] = [
    {
      id_ubicacion: 11,
      id_cliente: 3,
      numero_propiedad: 1,
      nombre_cliente: 'Sergio Morales',
      direccion: 'Sector Norte',
      latitud: 14.63,
      longitud: -90.5,
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-01T10:00:00',
    },
    {
      id_ubicacion: 12,
      id_cliente: 3,
      numero_propiedad: 2,
      nombre_cliente: 'Sergio Morales',
      direccion: 'Sector Sur',
      latitud: 14.61,
      longitud: -90.52,
      foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_12.webp',
      referencia: 'Portón azul',
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-02T10:00:00',
    },
    {
      id_ubicacion: 13,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'Cliente sin coordenadas',
      direccion: null,
      latitud: null,
      longitud: null,
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-03T10:00:00',
    },
  ];
  const antennas: Antena[] = [
    {
      id_antena: 8,
      nombre: 'Torre Norte',
      latitud: 14.65,
      longitud: -90.48,
      direccion_sector: null,
      referencia: null,
      foto_antena: null,
      estado: 'Activa',
    },
  ];

  beforeEach(async () => {
    markerCalls = [];
    markerHandlers = [];
    class MockMap {
      addListener(): { remove: () => void } {
        return { remove: vi.fn() };
      }
      setCenter(): void {}
      setZoom(): void {}
    }
    class MockMarker {
      map;
      position;

      constructor(options: {
        map: MockMap;
        position: { lat: number; lng: number };
        title: string;
        content?: Node;
      }) {
        this.map = options.map;
        this.position = options.position;
        markerCalls.push(options);
      }

      addListener(_eventName: string, handler: () => void): { remove: () => void } {
        markerHandlers.push(handler);
        return { remove: vi.fn() };
      }
    }
    locationsService = { getAll: vi.fn().mockReturnValue(of(properties)) };
    antennasService = { getAll: vi.fn().mockReturnValue(of(antennas)) };
    loader = {
      load: vi.fn().mockResolvedValue({
        Map: MockMap,
        AdvancedMarkerElement: MockMarker,
      }),
    };
    await TestBed.configureTestingModule({
      imports: [MapasComponent],
      providers: [
        { provide: UbicacionesClienteService, useValue: locationsService },
        { provide: AntenasService, useValue: antennasService },
        { provide: GoogleMapsLoaderService, useValue: loader },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MapasComponent);
    component = fixture.componentInstance;
  });

  it('carga ambas fuentes una vez y crea un marcador por ubicación válida', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));

    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(component.allItems().filter((item) => item.kind === 'property')).toHaveLength(2);
    expect(markerCalls.map((call) => call.title)).toEqual([
      'Sergio Morales · Propiedad 1',
      'Sergio Morales · Propiedad 2',
      'Torre Norte · Antena',
    ]);
  });

  it('combina filtros sin repetir llamadas HTTP', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));

    expect(component.visibleItems()).toHaveLength(3);
    component.setFilter('clients');
    expect(component.visibleItems()).toHaveLength(2);
    component.setFilter('antennas');
    expect(component.visibleItems()).toHaveLength(1);
    expect(component.visibleItems()[0].kind).toBe('antenna');
    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
  });

  it('busca por propiedad, dirección, antena y referencia', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));

    const input = document.createElement('input');
    input.value = 'Propiedad 2 portón azul';
    component.onSearch({ target: input } as unknown as Event);
    expect(component.visibleItems().map((item) => item.id)).toEqual([12]);

    input.value = 'Torre Norte';
    component.onSearch({ target: input } as unknown as Event);
    expect(component.visibleItems().map((item) => item.id)).toEqual([8]);
  });

  it('selecciona propiedades y antenas desde marcadores diferenciados', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerHandlers).toHaveLength(3));

    markerHandlers[0]();
    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ kind: 'property', idUbicacion: 11, subtitle: 'Propiedad 1' }),
    );
    markerHandlers[2]();
    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ kind: 'antenna', id: 8, title: 'Torre Norte' }),
    );
    expect((markerCalls[0].content as HTMLElement).getAttribute('aria-label')).toBe(
      'Propiedad de cliente',
    );
    expect((markerCalls[2].content as HTMLElement).getAttribute('aria-label')).toBe('Antena');
  });

  it('oculta datos opcionales sin mostrar placeholders', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerHandlers).toHaveLength(3));
    markerHandlers[0]();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sergio Morales');
    expect(fixture.nativeElement.textContent).not.toContain('Dirección no registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Sin referencia');
    expect(fixture.nativeElement.textContent).not.toContain('Foto no registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación geográfica pendiente');
  });

  it('muestra error controlado cuando falta configuración de Google Maps', async () => {
    loader.load.mockRejectedValue(new Error('Google Maps no está configurado para este entorno.'));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.mapError()).toContain('no está configurado'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Mapa no disponible');
    expect(fixture.nativeElement.textContent).toContain('Google Maps no está configurado');
  });
});
