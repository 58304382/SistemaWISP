import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  GoogleMapMouseEvent,
  GoogleMapsLoaderService,
} from '../../core/services/google-maps-loader.service';
import { PropertyMapComponent } from './property-map.component';

describe('PropertyMapComponent', () => {
  let fixture: ComponentFixture<PropertyMapComponent>;
  let component: PropertyMapComponent;
  let clickHandler: ((event: GoogleMapMouseEvent) => void) | null;
  let mapAddListener: ReturnType<typeof vi.fn>;
  let markerCalls: Array<{ map: unknown; position: { lat: number; lng: number } }>;
  let loader: { load: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    clickHandler = null;
    mapAddListener = vi.fn().mockImplementation((_eventName, handler) => {
      clickHandler = handler;
      return { remove: vi.fn() };
    });
    markerCalls = [];
    class MockMap {
      addListener = mapAddListener;
    }
    class MockMarker {
      map;
      position;

      constructor(options: { map: unknown; position: { lat: number; lng: number } }) {
        markerCalls.push(options);
        this.map = options.map;
        this.position = options.position;
      }
    }
    loader = {
      load: vi.fn().mockResolvedValue({
        Map: MockMap,
        AdvancedMarkerElement: MockMarker,
      }),
    };
    await TestBed.configureTestingModule({
      imports: [PropertyMapComponent],
      providers: [{ provide: GoogleMapsLoaderService, useValue: loader }],
    }).compileComponents();
    fixture = TestBed.createComponent(PropertyMapComponent);
    component = fixture.componentInstance;
  });

  it('seleccionar un punto mueve el marcador temporal y Confirmar lo emite', async () => {
    fixture.componentRef.setInput('mode', 'select');
    const confirmed = vi.fn();
    component.confirmed.subscribe(confirmed);
    fixture.detectChanges();
    await vi.waitFor(() => expect(mapAddListener).toHaveBeenCalledTimes(1));

    clickHandler?.({
      latLng: { toJSON: () => ({ lat: 14.63491424, lng: -90.50688246 }) },
    });
    component.confirmSelection();

    expect(component.selectedCoordinates()).toEqual({
      latitud: 14.6349142,
      longitud: -90.5068825,
    });
    expect(markerCalls).toHaveLength(1);
    expect(confirmed).toHaveBeenCalledWith({
      latitud: 14.6349142,
      longitud: -90.5068825,
    });
  });

  it('modo solo lectura crea marcador pero no registra selección', async () => {
    fixture.componentRef.setInput('mode', 'readonly');
    fixture.componentRef.setInput('initialCoordinates', {
      latitud: 14.6,
      longitud: -90.5,
    });
    fixture.componentRef.setInput('propertyNumber', 2);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(1));
    fixture.detectChanges();

    expect(markerCalls).toHaveLength(1);
    expect(mapAddListener).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Propiedad 2');
    expect(fixture.nativeElement.textContent).not.toContain('Confirmar ubicación');
  });

  it('si Maps falla conserva el punto inicial para confirmarlo sin persistir', async () => {
    loader.load.mockRejectedValue(new Error('No fue posible cargar Google Maps.'));
    fixture.componentRef.setInput('mode', 'select');
    fixture.componentRef.setInput('initialCoordinates', {
      latitud: 14.6,
      longitud: -90.5,
    });
    const confirmed = vi.fn();
    component.confirmed.subscribe(confirmed);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(component.loadError()).toBe('No fue posible cargar Google Maps.'),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No fue posible cargar Google Maps.');
    component.confirmSelection();
    expect(confirmed).toHaveBeenCalledWith({ latitud: 14.6, longitud: -90.5 });
  });
});
