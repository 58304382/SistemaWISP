import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  AdvancedMarkerInstance,
  GoogleMapInstance,
  GoogleMapsListener,
  GoogleMapsLoaderService,
  MapCoordinates,
} from '../../core/services/google-maps-loader.service';

export type PropertyMapMode = 'select' | 'readonly';

const DEFAULT_VIEW_CENTER = { lat: 14.6349, lng: -90.5069 };

@Component({
  selector: 'app-property-map',
  templateUrl: './property-map.component.html',
  styleUrl: './property-map.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertyMapComponent implements AfterViewInit, OnDestroy {
  private readonly loader = inject(GoogleMapsLoaderService);

  readonly mode = input.required<PropertyMapMode>();
  readonly initialCoordinates = input<MapCoordinates | null>(null);
  readonly propertyNumber = input<number | null>(null);
  readonly address = input<string | null>(null);
  readonly reference = input<string | null>(null);
  readonly confirmed = output<MapCoordinates>();
  readonly closed = output<void>();

  readonly isLoading = signal(true);
  readonly loadError = signal('');
  readonly selectedCoordinates = signal<MapCoordinates | null>(null);

  @ViewChild('mapContainer', { static: true })
  private mapContainer!: ElementRef<HTMLElement>;

  private map: GoogleMapInstance | null = null;
  private marker: AdvancedMarkerInstance | null = null;
  private mapClickListener: GoogleMapsListener | null = null;
  private destroyed = false;

  ngAfterViewInit(): void {
    const initial = this.initialCoordinates();
    this.selectedCoordinates.set(initial);
    this.loader
      .load()
      .then((api) => {
        if (this.destroyed) {
          return;
        }
        this.map = new api.Map(this.mapContainer.nativeElement, {
          center: initial ? { lat: initial.latitud, lng: initial.longitud } : DEFAULT_VIEW_CENTER,
          zoom: initial ? 18 : 13,
          // AdvancedMarkerElement requiere mapId; Google ofrece este ID para mapas básicos.
          mapId: 'DEMO_MAP_ID',
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        if (initial) {
          this.marker = new api.AdvancedMarkerElement({
            map: this.map,
            position: { lat: initial.latitud, lng: initial.longitud },
            title: this.markerTitle(),
          });
        }
        if (this.mode() === 'select') {
          this.mapClickListener = this.map.addListener('click', (event) => {
            const point = event.latLng?.toJSON();
            if (!point || !this.map) {
              return;
            }
            const coordinates = {
              latitud: Number(point.lat.toFixed(7)),
              longitud: Number(point.lng.toFixed(7)),
            };
            this.selectedCoordinates.set(coordinates);
            if (this.marker) {
              this.marker.position = { lat: coordinates.latitud, lng: coordinates.longitud };
            } else {
              this.marker = new api.AdvancedMarkerElement({
                map: this.map,
                position: { lat: coordinates.latitud, lng: coordinates.longitud },
                title: 'Ubicación seleccionada',
              });
            }
          });
        }
        this.isLoading.set(false);
      })
      .catch((error: unknown) => {
        if (this.destroyed) {
          return;
        }
        this.loadError.set(
          error instanceof Error ? error.message : 'No fue posible cargar Google Maps.',
        );
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mapClickListener?.remove();
    if (this.marker) {
      this.marker.map = null;
    }
  }

  confirmSelection(): void {
    const coordinates = this.selectedCoordinates();
    if (this.mode() === 'select' && coordinates) {
      this.confirmed.emit(coordinates);
    }
  }

  private markerTitle(): string {
    const number = this.propertyNumber();
    return number === null ? 'Ubicación seleccionada' : `Propiedad ${number}`;
  }
}
