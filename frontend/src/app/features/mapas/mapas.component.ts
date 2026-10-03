import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { API_BASE_URL } from '../../core/config/api.config';
import { Antena } from '../../core/models/antena.models';
import { UbicacionCliente } from '../../core/models/ubicacion-cliente.models';
import { AntenasService } from '../../core/services/antenas.service';
import {
  AdvancedMarkerInstance,
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleMapsListener,
  GoogleMapsLoaderService,
} from '../../core/services/google-maps-loader.service';
import { UbicacionesClienteService } from '../../core/services/ubicaciones-cliente.service';
import { getApiErrorMessage } from '../../core/utils/api-error';

type MapFilter = 'all' | 'clients' | 'antennas';

export interface PropertyMapItem {
  kind: 'property';
  id: number;
  idUbicacion: number;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  image: string | null;
  status: string;
  address: string | null;
  reference: string | null;
  propertyNumber: number;
}

export interface AntennaMapItem {
  kind: 'antenna';
  id: number;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  image: string | null;
  status: string;
  address: string | null;
  reference: string | null;
}

export type MapItem = PropertyMapItem | AntennaMapItem;

@Component({
  selector: 'app-mapas',
  templateUrl: './mapas.component.html',
  styleUrl: './mapas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapasComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly locationsService = inject(UbicacionesClienteService);
  private readonly antennasService = inject(AntenasService);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);

  readonly properties = signal<UbicacionCliente[]>([]);
  readonly antennas = signal<Antena[]>([]);
  readonly filter = signal<MapFilter>('all');
  readonly searchTerm = signal('');
  readonly selectedItem = signal<MapItem | null>(null);
  readonly navigationTarget = signal<MapItem | null>(null);
  readonly isLoadingData = signal(false);
  readonly dataError = signal('');
  readonly isLoadingMap = signal(true);
  readonly mapError = signal('');
  readonly actionMessage = signal('');

  readonly allItems = computed<MapItem[]>(() => [
    ...this.properties()
      .filter((location) => location.latitud !== null && location.longitud !== null)
      .map((location) => this.toPropertyItem(location)),
    ...this.antennas().map((antenna) => this.toAntennaItem(antenna)),
  ]);

  readonly visibleItems = computed(() => {
    const filter = this.filter();
    const search = this.normalize(this.searchTerm());
    return this.allItems().filter((item) => {
      if (filter === 'clients' && item.kind !== 'property') {
        return false;
      }
      if (filter === 'antennas' && item.kind !== 'antenna') {
        return false;
      }
      const searchable = this.searchText(item);
      return !search || search.split(/\s+/).every((term) => searchable.includes(term));
    });
  });

  @ViewChild('mapContainer', { static: true })
  private mapContainer!: ElementRef<HTMLElement>;

  private mapApi: GoogleMapsApi | null = null;
  private map: GoogleMapInstance | null = null;
  private markers: AdvancedMarkerInstance[] = [];
  private markerListeners: GoogleMapsListener[] = [];
  private destroyed = false;

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    this.mapsLoader
      .load()
      .then((api) => {
        if (this.destroyed) {
          return;
        }
        this.mapApi = api;
        this.map = new api.Map(this.mapContainer.nativeElement, {
          center: { lat: 14.6349, lng: -90.5069 },
          zoom: 12,
          mapId: 'DEMO_MAP_ID',
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        });
        this.isLoadingMap.set(false);
        this.renderMarkers();
      })
      .catch((error: unknown) => {
        if (this.destroyed) {
          return;
        }
        this.mapError.set(
          error instanceof Error ? error.message : 'No fue posible cargar Google Maps.',
        );
        this.isLoadingMap.set(false);
      });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearMarkers();
  }

  setFilter(filter: MapFilter): void {
    this.filter.set(filter);
    this.refreshVisibleMap();
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
      this.refreshVisibleMap();
    }
  }

  /** Permite que una ruta futura seleccione una propiedad sin crear otro mapa. */
  selectProperty(idUbicacion: number): void {
    const property = this.allItems().find(
      (item): item is PropertyMapItem =>
        item.kind === 'property' && item.idUbicacion === idUbicacion,
    );
    if (property) {
      this.selectItem(property);
    }
  }

  selectItem(item: MapItem): void {
    this.selectedItem.set(item);
    this.map?.setCenter({ lat: item.latitude, lng: item.longitude });
    this.map?.setZoom(17);
  }

  closeSelection(): void {
    this.selectedItem.set(null);
  }

  prepareDirections(item: MapItem): void {
    this.navigationTarget.set(item);
    this.actionMessage.set(`Destino preparado: ${item.title} · ${item.subtitle}.`);
  }

  showDetails(item: MapItem): void {
    this.actionMessage.set(
      item.kind === 'property' ? `${item.title} · ${item.subtitle}` : `Detalles de ${item.title}`,
    );
  }

  prepareAddLocation(): void {
    this.actionMessage.set('El registro de nuevas ubicaciones estará disponible próximamente.');
  }

  imageUrl(path: string | null): string | null {
    if (!path) {
      return null;
    }
    return /^https?:\/\//i.test(path)
      ? path
      : `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private loadData(): void {
    this.isLoadingData.set(true);
    this.dataError.set('');
    forkJoin({
      properties: this.locationsService.getAll(),
      antennas: this.antennasService.getAll(),
    })
      .pipe(finalize(() => this.isLoadingData.set(false)))
      .subscribe({
        next: ({ properties, antennas }) => {
          this.properties.set(properties);
          this.antennas.set(antennas);
          this.renderMarkers();
        },
        error: (error: unknown) => {
          this.dataError.set(
            getApiErrorMessage(error, 'No fue posible cargar las ubicaciones del mapa.'),
          );
        },
      });
  }

  /** Reconstruye solo la capa visual; filtros y búsqueda no repiten llamadas HTTP. */
  private renderMarkers(): void {
    if (!this.map || !this.mapApi) {
      return;
    }
    this.clearMarkers();
    const items = this.visibleItems();
    for (const item of items) {
      const marker = new this.mapApi.AdvancedMarkerElement({
        map: this.map,
        position: { lat: item.latitude, lng: item.longitude },
        title: `${item.title} · ${item.subtitle}`,
        content: this.markerContent(item),
      });
      this.markerListeners.push(marker.addListener('click', () => this.selectItem(item)));
      this.markers.push(marker);
    }
    if (items.length) {
      const center = items.reduce(
        (result, item) => ({
          lat: result.lat + item.latitude / items.length,
          lng: result.lng + item.longitude / items.length,
        }),
        { lat: 0, lng: 0 },
      );
      this.map.setCenter(center);
      this.map.setZoom(items.length === 1 ? 16 : 12);
    }
  }

  private refreshVisibleMap(): void {
    const selected = this.selectedItem();
    if (
      selected &&
      !this.visibleItems().some((item) => this.itemKey(item) === this.itemKey(selected))
    ) {
      this.selectedItem.set(null);
    }
    this.renderMarkers();
  }

  private clearMarkers(): void {
    for (const listener of this.markerListeners) {
      listener.remove();
    }
    for (const marker of this.markers) {
      marker.map = null;
    }
    this.markerListeners = [];
    this.markers = [];
  }

  private markerContent(item: MapItem): HTMLElement {
    const marker = document.createElement('div');
    marker.textContent = item.kind === 'property' ? '⌂' : '⌁';
    marker.setAttribute('aria-label', item.kind === 'property' ? 'Propiedad de cliente' : 'Antena');
    Object.assign(marker.style, {
      display: 'grid',
      placeItems: 'center',
      width: '34px',
      height: '34px',
      border: '3px solid #ffffff',
      borderRadius: item.kind === 'property' ? '50% 50% 50% 8px' : '9px',
      color: '#ffffff',
      background: item.kind === 'property' ? '#2862ad' : '#7557c9',
      boxShadow: '0 5px 15px rgba(25, 38, 58, 0.28)',
      fontSize: '20px',
      fontWeight: '800',
      transform: item.kind === 'property' ? 'rotate(-45deg)' : 'none',
      cursor: 'pointer',
    });
    if (item.kind === 'property') {
      const content = document.createElement('span');
      content.textContent = '⌂';
      content.style.transform = 'rotate(45deg)';
      marker.textContent = '';
      marker.append(content);
    }
    return marker;
  }

  private toPropertyItem(location: UbicacionCliente): PropertyMapItem {
    return {
      kind: 'property',
      id: location.id_ubicacion,
      idUbicacion: location.id_ubicacion,
      title: location.nombre_cliente,
      subtitle: `Propiedad ${location.numero_propiedad}`,
      latitude: location.latitud!,
      longitude: location.longitud!,
      image: location.foto_fachada,
      status: location.estado,
      address: location.direccion,
      reference: location.referencia,
      propertyNumber: location.numero_propiedad,
    };
  }

  private toAntennaItem(antenna: Antena): AntennaMapItem {
    return {
      kind: 'antenna',
      id: antenna.id_antena,
      title: antenna.nombre,
      subtitle: 'Antena',
      latitude: antenna.latitud,
      longitude: antenna.longitud,
      image: antenna.foto_antena,
      status: antenna.estado,
      address: antenna.direccion_sector,
      reference: antenna.referencia,
    };
  }

  private searchText(item: MapItem): string {
    return this.normalize(
      [item.title, item.subtitle, item.address, item.reference].filter(Boolean).join(' '),
    );
  }

  private itemKey(item: MapItem): string {
    return `${item.kind}:${item.id}`;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
