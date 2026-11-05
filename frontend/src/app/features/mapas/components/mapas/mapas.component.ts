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
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, forkJoin, of } from 'rxjs';
import { finalize, map, switchMap, takeUntil, tap } from 'rxjs/operators';

import { API_BASE_URL } from '../../../../core/config/api.config';
import { AuthService } from '../../../auth/services/auth.service';
import { Cliente, Departamento } from '../../../clientes/models/cliente.models';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Antena, AntenaCreate, AntenaUpdate } from '../../models/antena.models';
import {
  EstadoUbicacionCliente,
  UbicacionCliente,
  UbicacionClienteCreate,
  UbicacionClienteUpdate,
} from '../../models/ubicacion-cliente.models';
import { AntenasService } from '../../services/antenas.service';
import {
  AdvancedMarkerInstance,
  GoogleMapInstance,
  GoogleMapType,
  GoogleMapsApi,
  GoogleMapsListener,
  GoogleMapMouseEvent,
  GoogleMapsLoaderService,
} from '../../services/google-maps-loader.service';
import { UbicacionesClienteService } from '../../services/ubicaciones-cliente.service';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { Tarea } from '../../../tareas/models/tarea.models';
import { TareasService } from '../../../tareas/services/tareas.service';
import { VisitasTecnicasService } from '../../../visitas-tecnicas/services/visitas-tecnicas.service';

type MapFilter = 'all' | 'clients' | 'antennas';
type LocationFormType = 'client' | 'antenna';
type CoordinateStatus = 'pending' | 'registered' | 'selected';

const DEFAULT_MAP_CENTER = { lat: 14.6349, lng: -90.5069 };
const DEFAULT_MAP_ZOOM = 12;

export interface PropertyMapItem {
  kind: 'property';
  id: number;
  idUbicacion: number;
  title: string;
  subtitle: string;
  latitude: number | null;
  longitude: number | null;
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
type LocatedMapItem = MapItem & { latitude: number; longitude: number };

interface MarkerEntry {
  marker: AdvancedMarkerInstance;
  listener: GoogleMapsListener;
  content: HTMLElement;
}

interface FormCoordinates {
  latitud: number;
  longitud: number;
}

@Component({
  selector: 'app-mapas',
  imports: [ReactiveFormsModule],
  templateUrl: './mapas.component.html',
  styleUrl: './mapas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapasComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly locationsService = inject(UbicacionesClienteService);
  private readonly antennasService = inject(AntenasService);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly auth = inject(AuthService);
  private readonly clientsService = inject(ClientesService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly tasksService = inject(TareasService);
  private readonly visitsService = inject(VisitasTecnicasService);

  readonly properties = signal<UbicacionCliente[]>([]);
  readonly antennas = signal<Antena[]>([]);
  readonly filter = signal<MapFilter>('all');
  readonly mapType = signal<GoogleMapType>('roadmap');
  readonly searchTerm = signal('');
  readonly searchResultsOpen = signal(false);
  readonly selectedItem = signal<MapItem | null>(null);
  readonly navigationTarget = signal<MapItem | null>(null);
  readonly isLoadingData = signal(false);
  readonly propertiesError = signal('');
  readonly antennasError = signal('');
  readonly isLoadingMap = signal(true);
  readonly mapError = signal('');
  readonly actionMessage = signal('');
  readonly deleteConfirmation = signal<MapItem | null>(null);
  readonly deletingItemKey = signal<string | null>(null);
  readonly deleteError = signal('');
  // La navegación de instalaciones es de solo lectura, incluso para administradores.
  readonly canManageMap = computed(() => !this.isInstallationContext() && this.auth.isAdministrator());
  readonly isVisitContext = signal(false);
  readonly isInstallationContext = signal(false);
  readonly installationContextTask = signal<Tarea | null>(null);
  readonly isTaskContext = computed(() => this.isVisitContext() || this.isInstallationContext());
  readonly visitContextId = signal<number | null>(null);
  readonly visitContextTask = signal<Tarea | null>(null);
  readonly visitContextClient = signal<Cliente | null>(null);
  readonly pendingPropertyId = signal<number | null>(null);
  readonly canEditVisitLocation = computed(() => {
    const task = this.visitContextTask();
    return Boolean(
      task?.tipo === 'Visita Técnica' &&
      task.estado === 'En Proceso' &&
      task.es_responsable &&
      task.puede_realizar_acciones,
    );
  });
  readonly clients = signal<Cliente[]>([]);
  readonly departments = signal<Departamento[]>([]);
  readonly isLoadingClients = signal(false);
  readonly clientsError = signal('');
  readonly departmentsError = signal('');
  readonly isPropertyFormOpen = signal(false);
  readonly locationFormType = signal<LocationFormType>('client');
  readonly editingProperty = signal<UbicacionCliente | null>(null);
  readonly selectedClient = signal<Cliente | null>(null);
  readonly clientSearch = signal('');
  readonly clientProperties = signal<UbicacionCliente[]>([]);
  readonly selectedPropertyOption = signal<'new' | number | null>(null);
  readonly isLoadingClientProperties = signal(false);
  readonly selectedAntenna = signal<Antena | null>(null);
  readonly antennaSearch = signal('');
  readonly isLoadingSelection = signal(false);
  readonly coordinates = signal<FormCoordinates | null>(null);
  readonly coordinateStatus = signal<CoordinateStatus>('pending');
  readonly coordinateSelectionActive = signal(false);
  readonly selectionCoordinates = signal<FormCoordinates | null>(null);
  readonly isCapturingLocation = signal(false);
  readonly geolocationError = signal('');
  readonly gpsAccuracy = signal<number | null>(null);
  readonly receivedLocationOpen = signal(false);
  readonly receivedLocationUrl = signal('');
  readonly receivedLocationError = signal('');
  readonly isResolvingReceivedLocation = signal(false);
  readonly canProcessReceivedLocation = computed(
    () => Boolean(this.receivedLocationUrl().trim()) && !this.isResolvingReceivedLocation(),
  );
  readonly isSavingProperty = signal(false);
  readonly formSubmitted = signal(false);
  readonly propertyFormError = signal('');
  readonly facadePreview = signal<string | null>(null);
  readonly facadeFile = signal<File | null>(null);
  readonly originalFacade = signal<string | null>(null);
  readonly facadeRemovalRequested = signal(false);
  readonly isDirectPropertyEdit = computed(
    () => Boolean(this.editingProperty()) && !this.selectedClient(),
  );
  readonly directEditingProperty = computed(() =>
    this.selectedClient() ? null : this.editingProperty(),
  );
  readonly selectedDepartmentName = computed(() => {
    const idDepartamento = this.selectedClient()?.municipio.id_departamento;
    return this.departments().find((item) => item.id_departamento === idDepartamento)?.nombre ?? '';
  });
  readonly selectedMunicipalityName = computed(() => this.selectedClient()?.municipio.nombre ?? '');

  readonly propertyForm = this.formBuilder.nonNullable.group({
    direccion: ['', Validators.maxLength(500)],
    referencia: ['', Validators.maxLength(500)],
    observaciones: [''],
    estado: ['Activo' as EstadoUbicacionCliente, Validators.required],
  });

  readonly filteredClients = computed(() => {
    const search = this.normalize(this.clientSearch());
    if (!search || this.selectedClient()) {
      return [];
    }
    return this.clients()
      .filter((client) =>
        this.normalize(
          [client.id_cliente, client.nombres, client.apellidos, client.dpi, client.telefono].join(
            ' ',
          ),
        ).includes(search),
      )
      .slice(0, 8);
  });

  readonly allItems = computed<MapItem[]>(() => [
    ...this.properties().map((location) => this.toPropertyItem(location)),
    ...this.antennas().map((antenna) => this.toAntennaItem(antenna)),
  ]);

  readonly filteredItems = computed(() => {
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

  readonly visibleItems = computed<LocatedMapItem[]>(() =>
    this.filteredItems().filter((item): item is LocatedMapItem => this.hasCoordinates(item)),
  );

  readonly searchResults = computed(() =>
    this.normalize(this.searchTerm()) ? this.filteredItems() : [],
  );

  @ViewChild('mapContainer', { static: true })
  private mapContainer!: ElementRef<HTMLElement>;

  private mapApi: GoogleMapsApi | null = null;
  private map: GoogleMapInstance | null = null;
  private readonly markers = new Map<string, MarkerEntry>();
  private readonly destroy$ = new Subject<void>();
  private coordinateSelectionListener: GoogleMapsListener | null = null;
  private provisionalMarker: AdvancedMarkerInstance | null = null;
  private facadeObjectUrl: string | null = null;
  private newPropertyDraft: { direccion: string; referencia: string } | null = null;
  private geolocationRequestId = 0;
  private receivedLocationRequestId = 0;
  private pendingDataSources = 0;
  private initialViewportResolved = false;
  private destroyed = false;

  ngOnInit(): void {
    const visitContext = this.route?.snapshot.data['mapContext'] === 'visita';
    this.isVisitContext.set(visitContext);
    const installationContext = this.route?.snapshot.data['mapContext'] === 'instalacion';
    this.isInstallationContext.set(installationContext);
    if (installationContext) {
      const idInstalacion = Number(this.route?.snapshot.paramMap.get('idInstalacion'));
      if (!Number.isInteger(idInstalacion) || idInstalacion <= 0) {
        this.propertiesError.set('La instalación indicada no es válida.');
        return;
      }
      this.loadInstallationContext(idInstalacion);
      return;
    }
    if (!visitContext) {
      this.loadData();
      return;
    }

    const idVisita = Number(this.route?.snapshot.paramMap.get('idVisita'));
    if (!Number.isInteger(idVisita) || idVisita <= 0) {
      this.propertiesError.set('La visita indicada no es válida.');
      return;
    }
    this.visitContextId.set(idVisita);
    this.loadVisitContext(idVisita);
  }

  ngAfterViewInit(): void {
    this.initializeMap();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.geolocationRequestId += 1;
    this.receivedLocationRequestId += 1;
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCoordinateSelection();
    this.resetFacade();
    this.clearMarkers();
    this.map = null;
    this.mapApi = null;
  }

  retryMap(): void {
    if (!this.destroyed && !this.isLoadingMap()) {
      this.initializeMap();
    }
  }

  private initializeMap(): void {
    this.isLoadingMap.set(true);
    this.mapError.set('');
    this.mapsLoader
      .load()
      .then((api) => {
        if (this.destroyed) {
          return;
        }
        this.mapApi = api;
        this.map = new api.Map(this.mapContainer.nativeElement, {
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          mapId: api.mapId,
          mapTypeId: this.mapType(),
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        });
        this.isLoadingMap.set(false);
        this.syncMarkers();
        this.applyPendingPropertySelection();
        this.applyInitialDataViewport();
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

  setFilter(filter: MapFilter): void {
    this.filter.set(filter);
    this.refreshVisibleMap();
  }

  /** Cambia únicamente la capa base y conserva la instancia y su estado geográfico. */
  setMapType(mapType: GoogleMapType): void {
    if (this.mapType() === mapType) {
      return;
    }
    this.mapType.set(mapType);
    this.map?.setMapTypeId(mapType);
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
      this.searchResultsOpen.set(Boolean(input.value.trim()));
      this.refreshVisibleMap();
    }
  }

  openSearchResults(): void {
    this.searchResultsOpen.set(Boolean(this.searchTerm().trim()));
  }

  selectSearchResult(item: MapItem): void {
    this.searchResultsOpen.set(false);
    this.selectItem(item);
  }

  /** Permite que una ruta futura seleccione una propiedad sin crear otro mapa. */
  selectProperty(idUbicacion: number): void {
    this.pendingPropertyId.set(idUbicacion);
    this.applyPendingPropertySelection();
  }

  /** Aplica la selección cuando tanto la propiedad como la instancia del mapa están listas. */
  private applyPendingPropertySelection(): void {
    const idUbicacion = this.pendingPropertyId();
    if (idUbicacion === null) {
      return;
    }
    const property = this.allItems().find(
      (item): item is PropertyMapItem =>
        item.kind === 'property' && item.idUbicacion === idUbicacion,
    );
    if (property) {
      this.selectItem(property);
      if (this.map) {
        this.pendingPropertyId.set(null);
      }
    }
  }

  selectItem(item: MapItem): void {
    const previous = this.selectedItem();
    if (previous) {
      this.setMarkerHighlight(this.itemKey(previous), false);
    }
    this.selectedItem.set(item);
    this.actionMessage.set('');
    if (!this.hasCoordinates(item)) {
      this.actionMessage.set(`${item.title} · ${item.subtitle} no tiene coordenadas registradas.`);
      return;
    }
    this.setMarkerHighlight(this.itemKey(item), true);
    this.map?.setCenter({ lat: item.latitude, lng: item.longitude });
    this.map?.setZoom(item.kind === 'property' ? 17 : 16);
  }

  closeSelection(): void {
    const selected = this.selectedItem();
    if (selected) {
      this.setMarkerHighlight(this.itemKey(selected), false);
    }
    this.selectedItem.set(null);
  }

  requestDelete(item: MapItem): void {
    if (!this.canManageMap() || this.deletingItemKey()) {
      return;
    }
    this.deleteError.set('');
    this.deleteConfirmation.set(item);
  }

  cancelDelete(): void {
    if (!this.deletingItemKey()) {
      this.deleteConfirmation.set(null);
      this.deleteError.set('');
    }
  }

  /** Elimina solo el registro confirmado y sincroniza su marcador sin recargar datos. */
  confirmDelete(): void {
    const item = this.deleteConfirmation();
    if (!item || !this.canManageMap() || this.deletingItemKey()) {
      return;
    }
    const key = this.itemKey(item);
    const request =
      item.kind === 'property'
        ? this.locationsService.delete(item.idUbicacion)
        : this.antennasService.delete(item.id);
    this.deletingItemKey.set(key);
    this.deleteError.set('');
    request.pipe(finalize(() => this.deletingItemKey.set(null))).subscribe({
      next: () => {
        if (this.selectedItem() && this.itemKey(this.selectedItem()!) === key) {
          this.closeSelection();
        }
        if (this.navigationTarget() && this.itemKey(this.navigationTarget()!) === key) {
          this.navigationTarget.set(null);
        }
        if (item.kind === 'property') {
          this.properties.update((properties) =>
            properties.filter((property) => property.id_ubicacion !== item.idUbicacion),
          );
        } else {
          this.antennas.update((antennas) =>
            antennas.filter((antenna) => antenna.id_antena !== item.id),
          );
        }
        this.syncMarkers();
        this.deleteConfirmation.set(null);
        this.actionMessage.set(`${item.title} · ${item.subtitle} eliminado correctamente.`);
      },
      error: (error: unknown) => {
        this.deleteError.set(
          getApiErrorMessage(error, 'No fue posible eliminar la ubicación seleccionada.'),
        );
      },
    });
  }

  prepareDirections(item: MapItem): void {
    if (!this.hasCoordinates(item)) {
      this.actionMessage.set(
        `La ubicación de ${item.title} · ${item.subtitle} no está disponible.`,
      );
      return;
    }
    this.navigationTarget.set(item);
    const destination = encodeURIComponent(`${item.latitude},${item.longitude}`);
    const directionsUrl =
      `https://www.google.com/maps/dir/?api=1&destination=${destination}` + '&travelmode=driving';

    // La URL universal abre indicaciones web o la aplicación asociada sin fijar un origen.
    window.open(directionsUrl, '_blank', 'noopener,noreferrer');
  }

  showDetails(item: MapItem): void {
    this.actionMessage.set(
      item.kind === 'property' ? `${item.title} · ${item.subtitle}` : `Detalles de ${item.title}`,
    );
  }

  prepareAddLocation(): void {
    if (!this.canManageMap() || this.isSavingProperty()) {
      return;
    }
    this.closeSelection();
    this.locationFormType.set('client');
    this.resetLocationForm();
    this.isPropertyFormOpen.set(true);
    this.loadClients();
  }

  /** Reabre el alta contextual sin permitir elegir otro cliente o tipo de ubicación. */
  prepareVisitLocationRegistration(): void {
    const client = this.visitContextClient();
    const task = this.visitContextTask();
    if (!client || !task || task.id_ubicacion !== null || !this.canEditVisitLocation()) {
      return;
    }
    this.closeSelection();
    this.locationFormType.set('client');
    this.resetLocationForm();
    this.selectedClient.set(client);
    this.clientSearch.set(`${client.nombres} ${client.apellidos}`.trim());
    this.selectedPropertyOption.set('new');
    this.setNewPropertyDefaults(client);
    this.isPropertyFormOpen.set(true);
  }

  /** Abre el mismo formulario de Mapas limitado a la corrección autorizada por la visita. */
  editVisitLocation(item: PropertyMapItem): void {
    const client = this.visitContextClient();
    const task = this.visitContextTask();
    const property = this.properties().find(
      (candidate) => candidate.id_ubicacion === item.idUbicacion,
    );
    if (
      !client ||
      !task ||
      !property ||
      task.id_ubicacion !== property.id_ubicacion ||
      !this.canEditVisitLocation()
    ) {
      return;
    }
    this.locationFormType.set('client');
    this.resetLocationForm();
    this.selectedClient.set(client);
    this.clientSearch.set(`${client.nombres} ${client.apellidos}`.trim());
    this.clientProperties.set([property]);
    this.selectedPropertyOption.set(property.id_ubicacion);
    this.editingProperty.set(property);
    this.populateProperty(property);
    this.isPropertyFormOpen.set(true);
  }

  goBackToTasks(): void {
    void this.router?.navigate(['/tareas']);
  }

  /** Cambia el tipo sin conservar datos que pudieran pertenecer a otro registro. */
  onLocationTypeChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    this.locationFormType.set(select.value as LocationFormType);
    this.resetLocationForm();
    if (this.locationFormType() === 'client') {
      this.loadClients();
    }
  }

  /** Abre la edición con los datos que devolvió el listado protegido de Mapas. */
  editProperty(item: PropertyMapItem): void {
    if (!this.canManageMap() || this.isSavingProperty()) {
      return;
    }
    const property = this.properties().find(
      (candidate) => candidate.id_ubicacion === item.idUbicacion,
    );
    if (!property) {
      this.actionMessage.set('No fue posible encontrar la propiedad seleccionada.');
      return;
    }
    this.locationFormType.set('client');
    this.resetLocationForm();
    this.editingProperty.set(property);
    this.selectedPropertyOption.set(property.id_ubicacion);
    this.clientProperties.set([property]);
    this.selectedClient.set(null);
    this.clientSearch.set(property.nombre_cliente);
    this.populateProperty(property);
    this.isPropertyFormOpen.set(true);
  }

  /** Carga la antena actual desde FastAPI antes de habilitar su edición. */
  editAntenna(item: AntennaMapItem): void {
    if (!this.canManageMap() || this.isSavingProperty() || this.isLoadingSelection()) {
      return;
    }
    const antenna = this.antennas().find((candidate) => candidate.id_antena === item.id);
    if (!antenna) {
      this.actionMessage.set('No fue posible encontrar la antena seleccionada.');
      return;
    }
    this.locationFormType.set('antenna');
    this.resetLocationForm();
    this.isPropertyFormOpen.set(true);
    this.selectAntenna(antenna);
  }

  onClientSearch(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    if (this.selectedClient()) {
      this.selectedClient.set(null);
      this.clientProperties.set([]);
      this.selectedPropertyOption.set(null);
      this.editingProperty.set(null);
      this.newPropertyDraft = null;
      this.resetEditableLocation();
    }
    this.clientSearch.set(input.value);
  }

  selectClient(client: Cliente): void {
    this.resetEditableLocation();
    this.editingProperty.set(null);
    this.newPropertyDraft = null;
    this.selectedClient.set(client);
    this.clientSearch.set(`${client.nombres} ${client.apellidos}`.trim());
    this.clientProperties.set([]);
    this.selectedPropertyOption.set(null);
    this.setNewPropertyDefaults(client);
    this.propertyFormError.set('');
    this.isLoadingClientProperties.set(true);
    this.locationsService
      .getByClient(client.id_cliente)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.isLoadingClientProperties.set(false)),
      )
      .subscribe({
        next: (properties) => {
          this.clientProperties.set(properties);
          if (!properties.length) {
            this.selectedPropertyOption.set('new');
          }
        },
        error: (error: unknown) =>
          this.propertyFormError.set(
            getApiErrorMessage(error, 'No fue posible consultar las propiedades del cliente.'),
          ),
      });
  }

  changeClient(): void {
    this.selectedClient.set(null);
    this.clientSearch.set('');
    this.clientProperties.set([]);
    this.selectedPropertyOption.set(null);
    this.editingProperty.set(null);
    this.newPropertyDraft = null;
    this.resetEditableLocation();
  }

  /** Separa explícitamente una propiedad existente del alta de una propiedad nueva. */
  onPropertySelection(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const previousSelection = this.selectedPropertyOption();
    if (previousSelection === null || previousSelection === 'new') {
      this.captureNewPropertyDraft();
    }
    if (select.value === 'new') {
      this.selectedPropertyOption.set('new');
      this.editingProperty.set(null);
      this.resetEditableLocation();
      this.restoreNewPropertyDraft();
      return;
    }
    const idUbicacion = Number(select.value);
    const property = this.clientProperties().find(
      (candidate) => candidate.id_ubicacion === idUbicacion,
    );
    if (property) {
      this.selectedPropertyOption.set(idUbicacion);
      this.editingProperty.set(property);
      this.populateProperty(property);
    }
  }

  onAntennaSearch(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.selectedAntenna()) {
      return;
    }
    this.antennaSearch.set(input.value);
  }

  selectAntenna(antenna: Antena): void {
    if (this.isLoadingSelection()) {
      return;
    }
    this.isLoadingSelection.set(true);
    this.propertyFormError.set('');
    this.antennasService
      .getById(antenna.id_antena)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.isLoadingSelection.set(false)),
      )
      .subscribe({
        next: (current) => {
          this.selectedAntenna.set(current);
          this.antennaSearch.set(current.nombre);
          this.propertyForm.reset({
            direccion: current.direccion_sector ?? '',
            referencia: current.referencia ?? '',
            observaciones: '',
            estado: 'Activo',
          });
          this.coordinates.set({ latitud: current.latitud, longitud: current.longitud });
          this.coordinateStatus.set('registered');
          this.setExistingFacade(current.foto_antena);
        },
        error: (error: unknown) =>
          this.propertyFormError.set(
            getApiErrorMessage(error, 'No fue posible cargar la antena seleccionada.'),
          ),
      });
  }

  closePropertyForm(): void {
    if (this.isSavingProperty()) {
      return;
    }
    this.stopCoordinateSelection();
    this.geolocationRequestId += 1;
    this.isCapturingLocation.set(false);
    this.isPropertyFormOpen.set(false);
    this.resetLocationForm();
  }

  onFacadeSelected(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const file = input.files?.item(0);
    input.value = '';
    if (!file) {
      return;
    }
    const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!acceptedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
      this.propertyFormError.set('La fotografía debe ser JPEG, PNG o WEBP y no superar 5 MB.');
      return;
    }
    this.revokeFacadeObjectUrl();
    this.facadeFile.set(file);
    this.facadeObjectUrl = URL.createObjectURL(file);
    this.facadePreview.set(this.facadeObjectUrl);
    this.facadeRemovalRequested.set(false);
    this.propertyFormError.set('');
  }

  removeFacade(): void {
    if (this.facadeFile()) {
      this.revokeFacadeObjectUrl();
      this.facadeFile.set(null);
      this.facadePreview.set(this.originalFacade());
      return;
    }
    if (this.originalFacade()) {
      this.facadeRemovalRequested.set(true);
    }
    this.facadePreview.set(null);
  }

  /** Oculta el formulario y activa la selección sobre la instancia principal del mapa. */
  selectCoordinatesOnMap(): void {
    this.receivedLocationOpen.set(false);
    this.gpsAccuracy.set(null);
    this.startCoordinateSelection(this.coordinates());
  }

  /** Obtiene una lectura GPS y exige confirmarla en el mapa antes de usarla. */
  useCurrentLocation(): void {
    if (this.isCapturingLocation()) {
      return;
    }
    this.receivedLocationOpen.set(false);
    this.geolocationError.set('');
    if (!this.map || !this.mapApi || this.isLoadingMap() || this.mapError()) {
      this.propertyFormError.set('El mapa debe estar disponible para seleccionar coordenadas.');
      return;
    }
    if (!navigator.geolocation) {
      this.geolocationError.set('Este navegador no permite obtener la ubicación del dispositivo.');
      return;
    }

    const requestId = ++this.geolocationRequestId;
    this.isCapturingLocation.set(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== this.geolocationRequestId) {
          return;
        }
        const coordinates = {
          latitud: Number(position.coords.latitude.toFixed(7)),
          longitud: Number(position.coords.longitude.toFixed(7)),
        };
        this.isCapturingLocation.set(false);
        if (!this.areCoordinatesValid(coordinates)) {
          this.geolocationError.set('El dispositivo devolvió coordenadas fuera del rango válido.');
          return;
        }
        this.gpsAccuracy.set(
          Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : null,
        );
        this.startCoordinateSelection(coordinates);
      },
      (error) => {
        if (requestId !== this.geolocationRequestId) {
          return;
        }
        const message = {
          1: 'No se otorgó permiso para acceder a la ubicación.',
          2: 'No fue posible determinar la ubicación del dispositivo.',
          3: 'La obtención de la ubicación tardó demasiado.',
        }[error.code];
        this.geolocationError.set(
          message ?? 'No fue posible obtener la ubicación del dispositivo.',
        );
        this.isCapturingLocation.set(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  private startCoordinateSelection(initial: FormCoordinates | null): void {
    if (!this.map || !this.mapApi || this.isLoadingMap() || this.mapError()) {
      this.propertyFormError.set('El mapa debe estar disponible para seleccionar coordenadas.');
      return;
    }
    this.selectionCoordinates.set(initial);
    this.coordinateSelectionActive.set(true);
    this.closeSelection();
    this.coordinateSelectionListener = this.map.addListener('click', (event) =>
      this.updateProvisionalCoordinates(event),
    );
    const coordinates = this.selectionCoordinates();
    if (coordinates) {
      this.showProvisionalMarker(coordinates);
      this.map.setCenter({ lat: coordinates.latitud, lng: coordinates.longitud });
      this.map.setZoom(17);
    }
  }

  confirmCoordinates(): void {
    const coordinates = this.selectionCoordinates();
    if (!coordinates) {
      return;
    }
    this.coordinates.set(coordinates);
    this.coordinateStatus.set('selected');
    this.stopCoordinateSelection();
    this.propertyFormError.set('');
    this.geolocationError.set('');
  }

  cancelCoordinateSelection(): void {
    this.stopCoordinateSelection();
  }

  /** Solicita a FastAPI una resolución segura y conserva el formulario hasta confirmar. */
  obtainReceivedCoordinates(): void {
    if (this.isResolvingReceivedLocation()) {
      return;
    }
    this.receivedLocationError.set('');
    const enlace = this.receivedLocationUrl().trim();
    if (!enlace) {
      this.receivedLocationError.set('Ingresa un enlace de Google Maps.');
      return;
    }

    const requestId = ++this.receivedLocationRequestId;
    this.isResolvingReceivedLocation.set(true);
    this.locationsService
      .resolveGoogleMapsLink(enlace)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          if (requestId === this.receivedLocationRequestId) {
            this.isResolvingReceivedLocation.set(false);
          }
        }),
      )
      .subscribe({
        next: (coordinates) => {
          if (requestId !== this.receivedLocationRequestId) {
            return;
          }
          this.gpsAccuracy.set(null);
          this.startCoordinateSelection(coordinates);
        },
        error: (error: unknown) => {
          if (requestId === this.receivedLocationRequestId) {
            this.receivedLocationError.set(this.receivedLocationErrorMessage(error));
          }
        },
      });
  }

  saveLocation(): void {
    if (this.isVisitContext()) {
      this.saveVisitLocation();
      return;
    }
    if (this.isSavingProperty() || !this.canManageMap()) {
      return;
    }
    this.formSubmitted.set(true);
    this.propertyForm.markAllAsTouched();
    const type = this.locationFormType();
    const editing = this.editingProperty();
    const client = this.selectedClient();
    const antenna = this.selectedAntenna();
    const antennaName = this.antennaSearch().trim();
    const propertyOption = this.selectedPropertyOption();
    const coordinates = this.coordinates();
    const missingClientSelection =
      type === 'client' && !editing && (!client || propertyOption !== 'new');
    const invalidAntennaName = type === 'antenna' && (!antennaName || antennaName.length > 150);
    const missingAntennaCoordinates = type === 'antenna' && !coordinates;
    const invalidCoordinates = coordinates !== null && !this.areCoordinatesValid(coordinates);
    if (
      this.propertyForm.invalid ||
      missingClientSelection ||
      invalidAntennaName ||
      missingAntennaCoordinates ||
      invalidCoordinates
    ) {
      this.propertyFormError.set(
        missingClientSelection
          ? 'Selecciona un cliente y elige una propiedad existente o Nueva propiedad.'
          : invalidAntennaName
            ? 'El nombre de la antena es obligatorio y admite hasta 150 caracteres.'
            : missingAntennaCoordinates
              ? 'La antena debe conservar coordenadas geográficas válidas.'
              : invalidCoordinates
                ? 'Las coordenadas están fuera del rango geográfico válido.'
                : 'Revisa los campos del formulario.',
      );
      return;
    }

    const raw = this.propertyForm.getRawValue();
    const common: UbicacionClienteUpdate = {
      direccion: this.toNullableText(raw.direccion),
      referencia: this.toNullableText(raw.referencia),
      observaciones: this.toNullableText(raw.observaciones),
      latitud: coordinates?.latitud ?? null,
      longitud: coordinates?.longitud ?? null,
      estado: raw.estado,
    };
    const request: Observable<UbicacionCliente | Antena> =
      type === 'antenna'
        ? antenna
          ? this.updateAntenna(antenna.id_antena, {
              direccion_sector: common.direccion,
              referencia: common.referencia,
              latitud: coordinates!.latitud,
              longitud: coordinates!.longitud,
            })
          : this.antennasService.create(
              {
                nombre: antennaName,
                direccion_sector: common.direccion,
                referencia: common.referencia,
                latitud: coordinates!.latitud,
                longitud: coordinates!.longitud,
                estado: 'Activa',
              } satisfies AntenaCreate,
              this.facadeFile(),
            )
        : editing
          ? this.updateProperty(editing.id_ubicacion, common)
          : this.locationsService.create(
              { ...common, id_cliente: client!.id_cliente } satisfies UbicacionClienteCreate,
              this.facadeFile(),
            );

    this.isSavingProperty.set(true);
    this.propertyFormError.set('');
    request
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.isSavingProperty.set(false)),
      )
      .subscribe({
        next: (saved) => {
          if (type === 'antenna') {
            this.completeAntennaSave(saved as Antena, Boolean(antenna));
          } else {
            this.completePropertySave(saved as UbicacionCliente, Boolean(editing));
          }
        },
        error: (error: unknown) => {
          this.propertyFormError.set(
            getApiErrorMessage(error, 'No fue posible guardar la ubicación.'),
          );
        },
      });
  }

  /** Guarda por los endpoints de la visita, que validan asignación y estado en FastAPI. */
  private saveVisitLocation(): void {
    const task = this.visitContextTask();
    const idVisita = this.visitContextId();
    const coordinates = this.coordinates();
    const editing = this.editingProperty();
    const raw = this.propertyForm.getRawValue();
    const address = raw.direccion.trim();
    const isNewProperty = task?.id_ubicacion === null;
    if (this.isSavingProperty() || !task || idVisita === null || !this.canEditVisitLocation()) {
      return;
    }

    this.formSubmitted.set(true);
    if (!coordinates || !this.areCoordinatesValid(coordinates)) {
      this.propertyFormError.set('Selecciona y confirma coordenadas válidas en el mapa.');
      return;
    }
    if (isNewProperty && (!address || this.coordinateStatus() !== 'selected')) {
      this.propertyFormError.set(
        !address
          ? 'La dirección de la propiedad es obligatoria.'
          : 'Confirma en el mapa el marcador correspondiente al domicilio.',
      );
      return;
    }
    if (isNewProperty && !this.facadeFile()) {
      this.propertyFormError.set('La fotografía de fachada es obligatoria.');
      return;
    }
    if (!isNewProperty && editing?.id_ubicacion !== task.id_ubicacion) {
      this.propertyFormError.set('La propiedad seleccionada no corresponde a esta visita.');
      return;
    }

    const request = isNewProperty
      ? this.visitsService.registerFirstLocation(
          idVisita,
          {
            direccion: address,
            referencia: this.toNullableText(raw.referencia) ?? undefined,
            observaciones: this.toNullableText(raw.observaciones) ?? undefined,
            ...coordinates,
          },
          this.facadeFile() ?? undefined,
        )
      : this.visitsService.updateVisitLocation(
          idVisita,
          coordinates,
          this.facadeFile() ?? undefined,
        );

    this.isSavingProperty.set(true);
    this.propertyFormError.set('');
    request
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.isSavingProperty.set(false)),
      )
      .subscribe({
        next: (saved) => this.completeVisitLocationSave(saved, isNewProperty),
        error: (error: unknown) =>
          this.propertyFormError.set(
            getApiErrorMessage(error, 'No fue posible guardar la ubicación de la visita.'),
          ),
      });
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
    this.propertiesError.set('');
    this.antennasError.set('');
    this.pendingDataSources = 2;

    this.locationsService
      .getAll()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.completeDataSource()),
      )
      .subscribe({
        next: (properties) => {
          this.properties.set(properties);
          this.syncMarkers();
        },
        error: (error: unknown) => {
          this.propertiesError.set(
            `Propiedades: ${getApiErrorMessage(error, 'No fue posible cargar las propiedades.')}`,
          );
        },
      });

    this.antennasService
      .getAll()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.completeDataSource()),
      )
      .subscribe({
        next: (antennas) => {
          this.antennas.set(antennas);
          this.syncMarkers();
        },
        error: (error: unknown) => {
          this.antennasError.set(
            `Antenas: ${getApiErrorMessage(error, 'No fue posible cargar las antenas.')}`,
          );
        },
      });
  }

  /** Consulta la tarea autorizada y su FK directa, sin registrar ni corregir ubicaciones. */
  private loadInstallationContext(idInstalacion: number): void {
    this.isLoadingData.set(true);
    this.propertiesError.set('');
    this.filter.set('clients');
    this.tasksService
      .getAll()
      .pipe(
        switchMap((tasks) => {
          const task = tasks.find(
            (candidate) => candidate.tipo === 'Instalación' && candidate.id_instalacion === idInstalacion,
          );
          if (!task || !task.puede_ver) {
            throw new Error('La instalación no está disponible para este usuario.');
          }
          if (task.id_ubicacion === null) {
            throw new Error('La instalación no tiene una propiedad vinculada.');
          }
          return this.locationsService.getById(task.id_ubicacion).pipe(
            map((property) => ({ property, task })),
          );
        }),
        takeUntil(this.destroy$),
        finalize(() => this.isLoadingData.set(false)),
      )
      .subscribe({
        next: ({ property, task }) => {
          if (
            !property ||
            property.id_ubicacion !== task.id_ubicacion ||
            property.id_cliente !== task.id_cliente
          ) {
            this.propertiesError.set('La propiedad vinculada a la instalación no está disponible.');
            return;
          }
          this.installationContextTask.set(task);
          this.properties.set([property]);
          this.syncMarkers();
          this.selectProperty(property.id_ubicacion);
        },
        error: (error: unknown) =>
          this.propertiesError.set(
            getApiErrorMessage(error, 'No fue posible cargar el mapa de la instalación.'),
          ),
      });
  }

  /** Carga solo el cliente y la propiedad vinculados, nunca el inventario global de Mapas. */
  private loadVisitContext(idVisita: number): void {
    this.isLoadingData.set(true);
    this.propertiesError.set('');
    this.antennas.set([]);
    this.filter.set('clients');
    this.pendingDataSources = 0;
    this.tasksService
      .getAll()
      .pipe(
        switchMap((tasks) => {
          const task = tasks.find(
            (candidate) => candidate.tipo === 'Visita Técnica' && candidate.id_visita === idVisita,
          );
          if (!task || !task.puede_ver) {
            throw new Error('La visita no está disponible para este usuario.');
          }
          this.visitContextTask.set(task);
          return forkJoin({
            client: this.clientsService.getById(task.id_cliente),
            property:
              task.id_ubicacion === null
                ? of(null)
                : this.locationsService.getById(task.id_ubicacion),
          }).pipe(map((context) => ({ ...context, task })));
        }),
        takeUntil(this.destroy$),
        finalize(() => this.isLoadingData.set(false)),
      )
      .subscribe({
        next: ({ client, property, task }) => {
          if (
            property &&
            (property.id_ubicacion !== task.id_ubicacion || property.id_cliente !== task.id_cliente)
          ) {
            this.propertiesError.set('La propiedad vinculada a la visita no está disponible.');
            return;
          }
          this.visitContextClient.set(client);
          this.clients.set([client]);
          this.clientProperties.set(property ? [property] : []);
          this.properties.set(property ? [property] : []);
          this.loadDepartments();
          this.syncMarkers();
          if (property) {
            this.selectProperty(property.id_ubicacion);
          } else if (this.canEditVisitLocation()) {
            this.prepareVisitLocationRegistration();
          }
        },
        error: (error: unknown) =>
          this.propertiesError.set(
            getApiErrorMessage(error, 'No fue posible cargar el mapa de la visita.'),
          ),
      });
  }

  private loadClients(): void {
    this.loadDepartments();
    if (this.clients().length || this.isLoadingClients()) {
      return;
    }
    this.isLoadingClients.set(true);
    this.clientsError.set('');
    this.clientsService
      .getAll()
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.isLoadingClients.set(false)),
      )
      .subscribe({
        next: (clients) => this.clients.set(clients),
        error: (error: unknown) =>
          this.clientsError.set(
            getApiErrorMessage(error, 'No fue posible cargar los clientes existentes.'),
          ),
      });
  }

  private loadDepartments(): void {
    if (this.departments().length) {
      return;
    }
    this.departmentsError.set('');
    this.clientsService
      .getDepartamentos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (departments) => this.departments.set(departments),
        error: (error: unknown) =>
          this.departmentsError.set(
            getApiErrorMessage(error, 'No fue posible cargar el departamento del cliente.'),
          ),
      });
  }

  private updateProperty(
    idUbicacion: number,
    data: UbicacionClienteUpdate,
  ): Observable<UbicacionCliente> {
    return this.locationsService.update(idUbicacion, data).pipe(
      tap((saved) => this.upsertProperty(saved)),
      switchMap((saved) => {
        const photo = this.facadeFile();
        if (photo) {
          return this.locationsService.replacePhoto(idUbicacion, photo);
        }
        if (this.facadeRemovalRequested()) {
          return this.locationsService.removePhoto(idUbicacion);
        }
        return of(saved);
      }),
    );
  }

  private updateAntenna(idAntena: number, data: AntenaUpdate): Observable<Antena> {
    return this.antennasService.update(idAntena, data).pipe(
      tap((saved) => this.upsertAntenna(saved)),
      switchMap((saved) => {
        const photo = this.facadeFile();
        if (photo) {
          return this.antennasService.replacePhoto(idAntena, photo);
        }
        if (this.facadeRemovalRequested()) {
          return this.antennasService.removePhoto(idAntena);
        }
        return of(saved);
      }),
    );
  }

  private completePropertySave(saved: UbicacionCliente, wasEditing: boolean): void {
    const previous = this.selectedItem();
    if (previous && this.itemKey(previous) !== `property:${saved.id_ubicacion}`) {
      this.setMarkerHighlight(this.itemKey(previous), false);
    }
    this.upsertProperty(saved);
    this.isPropertyFormOpen.set(false);
    this.resetLocationForm();
    this.actionMessage.set(
      wasEditing
        ? `Propiedad ${saved.numero_propiedad} actualizada correctamente.`
        : `Propiedad ${saved.numero_propiedad} registrada correctamente.`,
    );
    const item = this.toPropertyItem(saved);
    this.selectedItem.set(item);
    if (this.hasCoordinates(item)) {
      this.setMarkerHighlight(this.itemKey(item), true);
      this.map?.setCenter({ lat: item.latitude, lng: item.longitude });
      this.map?.setZoom(17);
    }
  }

  private completeVisitLocationSave(saved: UbicacionCliente, wasNewProperty: boolean): void {
    this.upsertProperty(saved);
    this.clientProperties.set([saved]);
    this.visitContextTask.update((task) =>
      task
        ? {
            ...task,
            id_ubicacion: saved.id_ubicacion,
            numero_propiedad: saved.numero_propiedad,
            direccion_propiedad: saved.direccion,
            referencia_propiedad: saved.referencia,
            foto_fachada: saved.foto_fachada,
            latitud: saved.latitud,
            longitud: saved.longitud,
            ubicacion_disponible: saved.latitud !== null && saved.longitud !== null,
          }
        : task,
    );
    this.isPropertyFormOpen.set(false);
    this.resetLocationForm();
    this.actionMessage.set(
      wasNewProperty
        ? `Propiedad ${saved.numero_propiedad} registrada correctamente.`
        : `Ubicación de la Propiedad ${saved.numero_propiedad} actualizada correctamente.`,
    );
    this.selectProperty(saved.id_ubicacion);
  }

  private completeAntennaSave(saved: Antena, wasEditing: boolean): void {
    const previous = this.selectedItem();
    if (previous && this.itemKey(previous) !== `antenna:${saved.id_antena}`) {
      this.setMarkerHighlight(this.itemKey(previous), false);
    }
    this.upsertAntenna(saved);
    this.isPropertyFormOpen.set(false);
    this.resetLocationForm();
    this.actionMessage.set(
      wasEditing
        ? `Ubicación de ${saved.nombre} actualizada correctamente.`
        : `Antena ${saved.nombre} registrada correctamente.`,
    );
    const item = this.toAntennaItem(saved);
    this.selectedItem.set(item);
    this.setMarkerHighlight(this.itemKey(item), true);
    this.map?.setCenter({ lat: item.latitude, lng: item.longitude });
    this.map?.setZoom(16);
  }

  /** Sustituye solamente la propiedad afectada y conserva el estado visual del mapa. */
  private upsertProperty(saved: UbicacionCliente): void {
    this.properties.update((properties) => {
      const index = properties.findIndex(
        (property) => property.id_ubicacion === saved.id_ubicacion,
      );
      if (index === -1) {
        return [...properties, saved];
      }
      return properties.map((property) =>
        property.id_ubicacion === saved.id_ubicacion ? saved : property,
      );
    });
    this.syncMarkers();
  }

  private upsertAntenna(saved: Antena): void {
    this.antennas.update((antennas) => {
      const exists = antennas.some((antenna) => antenna.id_antena === saved.id_antena);
      return exists
        ? antennas.map((antenna) => (antenna.id_antena === saved.id_antena ? saved : antenna))
        : [...antennas, saved];
    });
    this.syncMarkers();
  }

  private updateProvisionalCoordinates(event: GoogleMapMouseEvent): void {
    const point = event.latLng?.toJSON();
    if (!point) {
      return;
    }
    const coordinates = {
      latitud: Number(point.lat.toFixed(7)),
      longitud: Number(point.lng.toFixed(7)),
    };
    if (!this.areCoordinatesValid(coordinates)) {
      return;
    }
    this.selectionCoordinates.set(coordinates);
    this.showProvisionalMarker(coordinates);
  }

  private showProvisionalMarker(coordinates: FormCoordinates): void {
    if (!this.map || !this.mapApi) {
      return;
    }
    if (this.provisionalMarker) {
      this.provisionalMarker.position = { lat: coordinates.latitud, lng: coordinates.longitud };
      return;
    }
    const content = document.createElement('div');
    content.textContent = '⌖';
    content.setAttribute('aria-label', 'Ubicación geográfica provisional');
    Object.assign(content.style, {
      display: 'grid',
      placeItems: 'center',
      width: '40px',
      height: '40px',
      border: '3px solid #ffffff',
      borderRadius: '50% 50% 50% 8px',
      color: '#ffffff',
      background: '#e07a29',
      boxShadow: '0 0 0 6px rgba(224, 122, 41, 0.22), 0 8px 20px rgba(25, 38, 58, 0.32)',
      fontSize: '23px',
      fontWeight: '800',
      transform: 'rotate(-45deg)',
    });
    this.provisionalMarker = new this.mapApi.AdvancedMarkerElement({
      map: this.map,
      position: { lat: coordinates.latitud, lng: coordinates.longitud },
      title: 'Ubicación geográfica provisional',
      content,
    });
  }

  private stopCoordinateSelection(): void {
    this.coordinateSelectionListener?.remove();
    this.coordinateSelectionListener = null;
    if (this.provisionalMarker) {
      this.provisionalMarker.map = null;
      this.provisionalMarker = null;
    }
    this.coordinateSelectionActive.set(false);
    this.selectionCoordinates.set(null);
    this.gpsAccuracy.set(null);
  }

  private setExistingFacade(path: string | null): void {
    this.resetFacade();
    const url = this.imageUrl(path);
    this.originalFacade.set(url);
    this.facadePreview.set(url);
  }

  private populateProperty(property: UbicacionCliente): void {
    this.propertyForm.reset({
      direccion: property.direccion ?? '',
      referencia: property.referencia ?? '',
      observaciones: property.observaciones ?? '',
      estado: property.estado,
    });
    this.coordinates.set(
      property.latitud !== null && property.longitud !== null
        ? { latitud: property.latitud, longitud: property.longitud }
        : null,
    );
    this.coordinateStatus.set(property.latitud !== null ? 'registered' : 'pending');
    this.setExistingFacade(property.foto_fachada);
    this.propertyFormError.set('');
  }

  /** Precarga únicamente el borrador de una propiedad nueva, sin modificar al cliente original. */
  private setNewPropertyDefaults(client: Cliente): void {
    this.newPropertyDraft = {
      direccion: client.direccion,
      referencia: client.referencia ?? '',
    };
    this.restoreNewPropertyDraft();
  }

  private captureNewPropertyDraft(): void {
    this.newPropertyDraft = {
      direccion: this.propertyForm.controls.direccion.value,
      referencia: this.propertyForm.controls.referencia.value,
    };
  }

  private restoreNewPropertyDraft(): void {
    if (!this.newPropertyDraft) {
      return;
    }
    this.propertyForm.patchValue(this.newPropertyDraft);
  }

  /** Limpia únicamente los datos editables al cambiar de propiedad o antena. */
  private resetEditableLocation(): void {
    this.geolocationRequestId += 1;
    this.isCapturingLocation.set(false);
    this.geolocationError.set('');
    this.receivedLocationOpen.set(false);
    this.receivedLocationUrl.set('');
    this.receivedLocationError.set('');
    this.receivedLocationRequestId += 1;
    this.isResolvingReceivedLocation.set(false);
    this.gpsAccuracy.set(null);
    this.coordinates.set(null);
    this.coordinateStatus.set('pending');
    this.propertyForm.reset({
      direccion: '',
      referencia: '',
      observaciones: '',
      estado: 'Activo',
    });
    this.resetFacade();
  }

  private resetLocationForm(): void {
    this.editingProperty.set(null);
    this.selectedClient.set(null);
    this.clientSearch.set('');
    this.clientProperties.set([]);
    this.selectedPropertyOption.set(null);
    this.selectedAntenna.set(null);
    this.antennaSearch.set('');
    this.formSubmitted.set(false);
    this.propertyFormError.set('');
    this.clientsError.set('');
    this.departmentsError.set('');
    this.newPropertyDraft = null;
    this.resetEditableLocation();
  }

  private resetFacade(): void {
    this.revokeFacadeObjectUrl();
    this.facadePreview.set(null);
    this.facadeFile.set(null);
    this.originalFacade.set(null);
    this.facadeRemovalRequested.set(false);
  }

  private revokeFacadeObjectUrl(): void {
    if (this.facadeObjectUrl) {
      URL.revokeObjectURL(this.facadeObjectUrl);
      this.facadeObjectUrl = null;
    }
  }

  private toNullableText(value: string): string | null {
    const normalized = value.trim();
    return normalized || null;
  }

  private areCoordinatesValid(coordinates: FormCoordinates): boolean {
    return (
      Number.isFinite(coordinates.latitud) &&
      Number.isFinite(coordinates.longitud) &&
      coordinates.latitud >= -90 &&
      coordinates.latitud <= 90 &&
      coordinates.longitud >= -180 &&
      coordinates.longitud <= 180
    );
  }

  /** Traduce los estados del endpoint sin ocultar errores funcionales conocidos. */
  private receivedLocationErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 502) {
        return 'No fue posible resolver el enlace de Google Maps.';
      }
      if (error.status === 504) {
        return 'La obtención de coordenadas agotó el tiempo de espera.';
      }
    }
    return getApiErrorMessage(error, 'No fue posible obtener las coordenadas del enlace.');
  }

  private completeDataSource(): void {
    this.pendingDataSources = Math.max(0, this.pendingDataSources - 1);
    if (!this.destroyed && this.pendingDataSources === 0) {
      this.isLoadingData.set(false);
      this.applyInitialDataViewport();
    }
  }

  /** Centra una sola vez los registros sin sobrescribir una cámara ya navegada o restaurada. */
  private applyInitialDataViewport(): void {
    if (this.initialViewportResolved || this.pendingDataSources !== 0 || !this.map) {
      return;
    }
    const currentCenter = this.map.getCenter()?.toJSON();
    const currentZoom = this.map.getZoom();
    if (!currentCenter || currentZoom === undefined) {
      return;
    }
    this.initialViewportResolved = true;
    const cameraIsDefault =
      Math.abs(currentCenter.lat - DEFAULT_MAP_CENTER.lat) < 0.0000001 &&
      Math.abs(currentCenter.lng - DEFAULT_MAP_CENTER.lng) < 0.0000001 &&
      currentZoom === DEFAULT_MAP_ZOOM;
    if (!cameraIsDefault) {
      return;
    }
    const locations = this.allItems().filter((item): item is LocatedMapItem =>
      this.hasCoordinates(item),
    );
    if (!locations.length) {
      return;
    }
    const center = locations.reduce(
      (result, item) => ({
        lat: result.lat + item.latitude / locations.length,
        lng: result.lng + item.longitude / locations.length,
      }),
      { lat: 0, lng: 0 },
    );
    this.map.setCenter(center);
    this.map.setZoom(DEFAULT_MAP_ZOOM);
  }

  /** Crea cada marcador una sola vez y conserva su instancia entre filtros y búsquedas. */
  private syncMarkers(): void {
    if (!this.map || !this.mapApi) {
      return;
    }
    const locatedItems = this.allItems().filter((item): item is LocatedMapItem =>
      this.hasCoordinates(item),
    );
    const currentKeys = new Set(locatedItems.map((item) => this.itemKey(item)));
    for (const [key, entry] of this.markers) {
      if (!currentKeys.has(key)) {
        entry.listener.remove();
        entry.marker.map = null;
        this.markers.delete(key);
      }
    }
    for (const item of locatedItems) {
      const key = this.itemKey(item);
      const existing = this.markers.get(key);
      if (existing) {
        existing.marker.position = { lat: item.latitude, lng: item.longitude };
        continue;
      }
      const content = this.markerContent(item);
      const marker = new this.mapApi.AdvancedMarkerElement({
        map: this.map,
        position: { lat: item.latitude, lng: item.longitude },
        title: `${item.title} · ${item.subtitle}`,
        content,
      });
      const listener = marker.addListener('click', () => this.selectItemByKey(key));
      this.markers.set(key, { marker, listener, content });
    }
    this.updateMarkerVisibility();
  }

  private refreshVisibleMap(): void {
    const selected = this.selectedItem();
    if (
      selected &&
      !this.filteredItems().some((item) => this.itemKey(item) === this.itemKey(selected))
    ) {
      this.closeSelection();
    }
    this.updateMarkerVisibility();
  }

  /** Alternar visibilidad no reemplaza marcadores ni modifica la cámara actual. */
  private updateMarkerVisibility(): void {
    if (!this.map) {
      return;
    }
    const visibleKeys = new Set(this.visibleItems().map((item) => this.itemKey(item)));
    for (const [key, entry] of this.markers) {
      entry.marker.map = visibleKeys.has(key) ? this.map : null;
    }
  }

  private clearMarkers(): void {
    for (const entry of this.markers.values()) {
      entry.listener.remove();
      entry.marker.map = null;
    }
    this.markers.clear();
  }

  private selectItemByKey(key: string): void {
    const item = this.allItems().find((candidate) => this.itemKey(candidate) === key);
    if (item) {
      this.selectItem(item);
    }
  }

  private setMarkerHighlight(key: string, selected: boolean): void {
    const content = this.markers.get(key)?.content;
    if (!content) {
      return;
    }
    content.style.outline = selected ? '4px solid rgba(255, 190, 55, 0.9)' : 'none';
    content.style.boxShadow = selected
      ? '0 0 0 7px rgba(255, 190, 55, 0.24), 0 8px 20px rgba(25, 38, 58, 0.35)'
      : '0 5px 15px rgba(25, 38, 58, 0.28)';
    content.setAttribute('aria-current', selected ? 'true' : 'false');
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
      latitude: location.latitud,
      longitude: location.longitud,
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

  hasCoordinates(item: MapItem): item is LocatedMapItem {
    return (
      item.latitude !== null &&
      item.longitude !== null &&
      this.areCoordinatesValid({ latitud: item.latitude, longitud: item.longitude })
    );
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
