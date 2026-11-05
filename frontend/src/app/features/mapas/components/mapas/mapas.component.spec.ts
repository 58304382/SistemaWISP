import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../../auth/services/auth.service';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.models';
import { Antena } from '../../models/antena.models';
import { UbicacionCliente } from '../../models/ubicacion-cliente.models';
import { AntenasService } from '../../services/antenas.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { UbicacionesClienteService } from '../../services/ubicaciones-cliente.service';
import { MapasComponent, PropertyMapItem } from './mapas.component';
import { Tarea } from '../../../tareas/models/tarea.models';
import { TareasService } from '../../../tareas/services/tareas.service';
import { VisitasTecnicasService } from '../../../visitas-tecnicas/services/visitas-tecnicas.service';

describe('MapasComponent', () => {
  let fixture: ComponentFixture<MapasComponent>;
  let component: MapasComponent;
  let locationsService: {
    getAll: ReturnType<typeof vi.fn>;
    getByClient: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    resolveGoogleMapsLink: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    replacePhoto: ReturnType<typeof vi.fn>;
    removePhoto: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let clientsService: {
    getAll: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getDepartamentos: ReturnType<typeof vi.fn>;
  };
  let antennasService: {
    getAll: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    replacePhoto: ReturnType<typeof vi.fn>;
    removePhoto: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let loader: { load: ReturnType<typeof vi.fn> };
  let auth: { isAdministrator: ReturnType<typeof vi.fn> };
  let tasksService: { getAll: ReturnType<typeof vi.fn> };
  let visitsService: {
    registerFirstLocation: ReturnType<typeof vi.fn>;
    updateVisitLocation: ReturnType<typeof vi.fn>;
  };
  let route: {
    snapshot: { data: Record<string, unknown>; paramMap: ReturnType<typeof convertToParamMap> };
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let geolocation: { getCurrentPosition: ReturnType<typeof vi.fn> };
  let markerCalls: Array<{ title: string; content?: Node }>;
  let markerHandlers: Array<() => void>;
  let markerInstances: Array<{ map: unknown; position: { lat: number; lng: number } }>;
  let mapSetCenter: ReturnType<typeof vi.fn>;
  let mapSetZoom: ReturnType<typeof vi.fn>;
  let mapSetMapTypeId: ReturnType<typeof vi.fn>;
  let mapCalls: Array<{ mapTypeId: string }>;
  let mapCenter: { lat: number; lng: number };
  let mapZoom: number;
  let mapClickHandler:
    ((event: { latLng: { toJSON: () => { lat: number; lng: number } } }) => void) | null;

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
  const clients: Cliente[] = [
    {
      id_cliente: 3,
      id_municipio: 1,
      nombres: 'Sergio',
      apellidos: 'Morales',
      dpi: '1234567890101',
      telefono: '55550000',
      correo: null,
      direccion: 'Zona 1',
      referencia: null,
      estado: 'Activo',
      municipio: {
        id_municipio: 1,
        id_departamento: 1,
        nombre: 'Guatemala',
        codigo_postal: null,
        estado: 'Activo',
      },
    },
    {
      id_cliente: 4,
      id_municipio: 2,
      nombres: 'Ana',
      apellidos: 'López',
      dpi: '2234567890101',
      telefono: '55551111',
      correo: null,
      direccion: 'Avenida Central 4-20',
      referencia: 'Frente al parque',
      estado: 'Activo',
      municipio: {
        id_municipio: 2,
        id_departamento: 2,
        nombre: 'Quetzaltenango',
        codigo_postal: null,
        estado: 'Activo',
      },
    },
  ];
  const visitTask: Tarea = {
    id: 15,
    tipo: 'Visita Técnica',
    id_visita: 15,
    id_instalacion: null,
    id_cliente: 3,
    id_ubicacion: 12,
    numero_propiedad: 2,
    direccion_propiedad: 'Sector Sur',
    referencia_propiedad: 'Portón azul',
    foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_12.webp',
    latitud: 14.61,
    longitud: -90.52,
    cliente: 'Sergio Morales',
    fecha: '2026-10-09',
    hora: '09:00:00',
    descripcion: 'Evaluación técnica',
    estado: 'En Proceso',
    id_tipo_instalacion: 2,
    tipo_instalacion: 'Internet',
    tecnicos: [],
    ubicacion_disponible: true,
    puede_ver: true,
    puede_realizar_acciones: true,
    es_responsable: true,
    bloqueada: false,
  };

  beforeEach(async () => {
    markerCalls = [];
    markerHandlers = [];
    markerInstances = [];
    mapCenter = { lat: 14.6349, lng: -90.5069 };
    mapZoom = 12;
    mapSetCenter = vi.fn((center: { lat: number; lng: number }) => {
      mapCenter = center;
    });
    mapSetZoom = vi.fn((zoom: number) => {
      mapZoom = zoom;
    });
    mapSetMapTypeId = vi.fn();
    mapCalls = [];
    mapClickHandler = null;
    geolocation = { getCurrentPosition: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    class MockMap {
      constructor(
        _element: HTMLElement,
        options: { center: { lat: number; lng: number }; zoom: number; mapTypeId: string },
      ) {
        mapCenter = options.center;
        mapZoom = options.zoom;
        mapCalls.push(options);
      }

      addListener(
        eventName: string,
        handler: (event: { latLng: { toJSON: () => { lat: number; lng: number } } }) => void,
      ): { remove: () => void } {
        if (eventName === 'click') {
          mapClickHandler = handler;
        }
        return { remove: vi.fn() };
      }
      getCenter(): { toJSON: () => { lat: number; lng: number } } {
        return { toJSON: () => mapCenter };
      }
      getZoom(): number {
        return mapZoom;
      }
      setCenter = mapSetCenter;
      setZoom = mapSetZoom;
      setMapTypeId = mapSetMapTypeId;
    }
    class MockMarker {
      map;
      position;

      constructor(options: {
        map?: MockMap;
        position: { lat: number; lng: number };
        title: string;
        content?: Node;
      }) {
        this.map = options.map;
        this.position = options.position;
        markerCalls.push(options);
        markerInstances.push(this);
      }

      addListener(_eventName: string, handler: () => void): { remove: () => void } {
        markerHandlers.push(handler);
        return { remove: vi.fn() };
      }
    }
    locationsService = {
      getAll: vi.fn().mockReturnValue(of(properties)),
      getByClient: vi
        .fn()
        .mockImplementation((idCliente: number) =>
          of(properties.filter((item) => item.id_cliente === idCliente)),
        ),
      getById: vi
        .fn()
        .mockImplementation((idUbicacion: number) =>
          of(properties.find((item) => item.id_ubicacion === idUbicacion)!),
        ),
      resolveGoogleMapsLink: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      replacePhoto: vi.fn(),
      removePhoto: vi.fn(),
      delete: vi.fn(),
    };
    clientsService = {
      getAll: vi.fn().mockReturnValue(of(clients)),
      getById: vi
        .fn()
        .mockImplementation((idCliente: number) =>
          of(clients.find((client) => client.id_cliente === idCliente)!),
        ),
      getDepartamentos: vi.fn().mockReturnValue(
        of([
          { id_departamento: 1, nombre: 'Guatemala', codigo: '01', estado: 'Activo' },
          { id_departamento: 2, nombre: 'Quetzaltenango', codigo: '09', estado: 'Activo' },
        ]),
      ),
    };
    antennasService = {
      getAll: vi.fn().mockReturnValue(of(antennas)),
      getById: vi.fn().mockReturnValue(of(antennas[0])),
      create: vi.fn(),
      update: vi.fn(),
      replacePhoto: vi.fn(),
      removePhoto: vi.fn(),
      delete: vi.fn(),
    };
    auth = { isAdministrator: vi.fn().mockReturnValue(false) };
    tasksService = { getAll: vi.fn().mockReturnValue(of([])) };
    visitsService = {
      registerFirstLocation: vi.fn(),
      updateVisitLocation: vi.fn(),
    };
    route = { snapshot: { data: {}, paramMap: convertToParamMap({}) } };
    router = { navigate: vi.fn().mockResolvedValue(true) };
    loader = {
      load: vi.fn().mockResolvedValue({
        mapId: 'test-map-id',
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
        { provide: AuthService, useValue: auth },
        { provide: ClientesService, useValue: clientsService },
        { provide: TareasService, useValue: tasksService },
        { provide: VisitasTecnicasService, useValue: visitsService },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MapasComponent);
    component = fixture.componentInstance;
  });

  function activateVisitContext(task: Tarea): void {
    fixture.destroy();
    route.snapshot.data = { mapContext: 'visita' };
    route.snapshot.paramMap = convertToParamMap({ idVisita: String(task.id_visita) });
    tasksService.getAll.mockReturnValue(of([task]));
    fixture = TestBed.createComponent(MapasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Simula el acceso directo a la instalación usando la fuente autorizada de Mis tareas. */
  function activateInstallationContext(task: Tarea = {
    ...visitTask, tipo: 'Instalación', id_instalacion: 7,
  }): void {
    fixture.destroy();
    route.snapshot.data = { mapContext: 'instalacion' };
    route.snapshot.paramMap = convertToParamMap({ idInstalacion: '7' });
    tasksService.getAll.mockReturnValue(of([task]));
    fixture = TestBed.createComponent(MapasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('selecciona y centra la propiedad directa de la instalación y abre su ruta en Google Maps', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    // La respuesta de la propiedad, no las coordenadas antiguas de la tarjeta, define el destino.
    activateInstallationContext({ ...visitTask, tipo: 'Instalación', id_instalacion: 7, latitud: 1 });
    await vi.waitFor(() => expect(component.isLoadingMap()).toBe(false));
    fixture.detectChanges();
    expect(locationsService.getById).toHaveBeenCalledWith(12);
    expect(locationsService.getAll).not.toHaveBeenCalled();
    expect(locationsService.getByClient).not.toHaveBeenCalled();
    expect(antennasService.getAll).not.toHaveBeenCalled();
    expect(clientsService.getAll).not.toHaveBeenCalled();
    expect(component.properties()).toEqual([properties[1]]);
    expect(component.selectedItem()).toEqual(expect.objectContaining({ idUbicacion: 12 }));
    expect(mapSetCenter).toHaveBeenLastCalledWith({ lat: 14.61, lng: -90.52 });
    expect(mapSetZoom).toHaveBeenLastCalledWith(17);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.detail-actions button')) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.includes('Cómo llegar'))!.click();
    expect(open).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=14.61%2C-90.52&travelmode=driving',
      '_blank', 'noopener,noreferrer',
    );
    component.goBackToTasks();
    expect(router.navigate).toHaveBeenCalledWith(['/tareas']);
    open.mockRestore();
  });

  it('resuelve la selección de instalación cuando la propiedad llega después del mapa', async () => {
    const response = new Subject<UbicacionCliente>();
    locationsService.getById.mockReturnValue(response);
    activateInstallationContext();
    await vi.waitFor(() => expect(component.isLoadingMap()).toBe(false));
    expect(component.selectedItem()).toBeNull();
    response.next(properties[1]);
    response.complete();
    expect(component.selectedItem()).toEqual(expect.objectContaining({ idUbicacion: 12 }));
    expect(mapSetCenter).toHaveBeenLastCalledWith({ lat: 14.61, lng: -90.52 });
  });

  it('mantiene la instalación en solo lectura incluso como administrador', async () => {
    auth.isAdministrator.mockReturnValue(true);
    activateInstallationContext();
    await vi.waitFor(() => expect(component.selectedItem()).not.toBeNull());
    fixture.detectChanges();
    const item = component.selectedItem() as PropertyMapItem;
    component.prepareAddLocation();
    component.editProperty(item);
    component.requestDelete(item);
    component.confirmDelete();
    component.prepareVisitLocationRegistration();
    component.editVisitLocation(item);
    component.saveLocation();
    expect(component.canManageMap()).toBe(false);
    expect(component.canEditVisitLocation()).toBe(false);
    expect(component.isPropertyFormOpen()).toBe(false);
    expect(component.deleteConfirmation()).toBeNull();
    for (const text of ['Agregar ubicación', 'Registrar ubicación', 'Corregir ubicación', 'Editar', 'Eliminar']) {
      expect(fixture.nativeElement.textContent).not.toContain(text);
    }
    for (const method of ['create', 'update', 'delete', 'replacePhoto', 'removePhoto'] as const) {
      expect(locationsService[method]).not.toHaveBeenCalled();
    }
    expect(visitsService.registerFirstLocation).not.toHaveBeenCalled();
    expect(visitsService.updateVisitLocation).not.toHaveBeenCalled();
  });

  it.each([
    { puede_ver: false },
    { id_instalacion: 8 },
    { id_ubicacion: null },
  ])('rechaza una instalación no disponible o sin propiedad: %j', (invalid) => {
    activateInstallationContext({ ...visitTask, tipo: 'Instalación', id_instalacion: 7, ...invalid });
    expect(component.propertiesError()).not.toBe('');
    expect(locationsService.getById).not.toHaveBeenCalled();
    expect(locationsService.getAll).not.toHaveBeenCalled();
    expect(component.selectedItem()).toBeNull();
    expect(component.isPropertyFormOpen()).toBe(false);
  });

  it.each([{ id_cliente: 4 }, { id_ubicacion: 11 }])('rechaza una propiedad ajena a la instalación: %j', (invalid) => {
    locationsService.getById.mockReturnValue(of({ ...properties[1], ...invalid }));
    activateInstallationContext();
    expect(component.propertiesError()).toContain('no está disponible');
    expect(component.properties()).toEqual([]);
    expect(component.selectedItem()).toBeNull();
  });

  it('muestra el error de consulta sin buscar una propiedad alternativa', () => {
    locationsService.getById.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    activateInstallationContext();
    expect(component.propertiesError()).not.toBe('');
    expect(component.properties()).toEqual([]);
    expect(locationsService.getByClient).not.toHaveBeenCalled();
    expect(locationsService.getAll).not.toHaveBeenCalled();
  });

  it('consulta una propiedad sin coordenadas sin ofrecer registro ni indicaciones', async () => {
    locationsService.getById.mockReturnValue(of({ ...properties[1], latitud: null, longitud: null }));
    activateInstallationContext();
    await vi.waitFor(() => expect(component.isLoadingMap()).toBe(false));
    fixture.detectChanges();
    expect(component.actionMessage()).toContain('no tiene coordenadas');
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(component.isPropertyFormOpen()).toBe(false);
  });

  it('oculta la administración al técnico', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Agregar ubicación');
  });

  it('muestra la administración al Administrador', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Agregar ubicación');
  });

  it('carga solo la propiedad indicada por id_ubicacion y abre su tarjeta contextual', async () => {
    activateVisitContext(visitTask);
    await vi.waitFor(() => expect(component.selectedItem()).not.toBeNull());
    fixture.detectChanges();

    expect(locationsService.getAll).not.toHaveBeenCalled();
    expect(antennasService.getAll).not.toHaveBeenCalled();
    expect(locationsService.getById).toHaveBeenCalledWith(12);
    expect(locationsService.getByClient).not.toHaveBeenCalled();
    expect(component.properties()).toEqual([properties[1]]);
    expect(component.selectedItem()).toEqual(expect.objectContaining({ idUbicacion: 12 }));
    const card = fixture.nativeElement.querySelector('.map-detail-card') as HTMLElement;
    expect(card.textContent).toContain('Propiedad 2');
    expect(card.textContent).toContain('Cómo llegar');
    expect(card.textContent).toContain('Corregir ubicación');
  });

  it('registra desde el formulario existente mediante el endpoint contextual de la visita', () => {
    const taskWithoutLocation: Tarea = {
      ...visitTask,
      id_ubicacion: null,
      numero_propiedad: null,
      direccion_propiedad: null,
      referencia_propiedad: null,
      foto_fachada: null,
      latitud: null,
      longitud: null,
      ubicacion_disponible: false,
    };
    const saved = { ...properties[1], id_ubicacion: 14, numero_propiedad: 3 };
    visitsService.registerFirstLocation.mockReturnValue(of(saved));
    activateVisitContext(taskWithoutLocation);

    expect(component.isPropertyFormOpen()).toBe(true);
    expect(component.selectedClient()?.id_cliente).toBe(3);
    expect(component.selectedPropertyOption()).toBe('new');
    component.propertyForm.patchValue({
      direccion: 'Sector nuevo',
      referencia: 'Casa blanca',
      observaciones: 'Portón lateral',
    });
    component.coordinates.set({ latitud: 14.62, longitud: -90.51 });
    component.coordinateStatus.set('selected');
    const photo = new File(['image'], 'fachada.webp', { type: 'image/webp' });
    component.facadeFile.set(photo);

    component.saveLocation();

    expect(visitsService.registerFirstLocation).toHaveBeenCalledWith(
      15,
      {
        direccion: 'Sector nuevo',
        referencia: 'Casa blanca',
        observaciones: 'Portón lateral',
        latitud: 14.62,
        longitud: -90.51,
      },
      photo,
    );
    expect(locationsService.create).not.toHaveBeenCalled();
    expect(component.visitContextTask()?.id_ubicacion).toBe(14);
    expect(component.selectedItem()).toEqual(expect.objectContaining({ idUbicacion: 14 }));
  });

  it('corrige la propiedad contextual sin habilitar edición administrativa', () => {
    const saved = { ...properties[1], latitud: 14.64, longitud: -90.54 };
    visitsService.updateVisitLocation.mockReturnValue(of(saved));
    activateVisitContext(visitTask);
    component.editVisitLocation(component.selectedItem() as PropertyMapItem);
    component.coordinates.set({ latitud: 14.64, longitud: -90.54 });
    component.coordinateStatus.set('selected');

    component.saveLocation();

    expect(visitsService.updateVisitLocation).toHaveBeenCalledWith(
      15,
      { latitud: 14.64, longitud: -90.54 },
      undefined,
    );
    expect(locationsService.update).not.toHaveBeenCalled();
    expect(locationsService.replacePhoto).not.toHaveBeenCalled();
    expect(locationsService.removePhoto).not.toHaveBeenCalled();
    expect(locationsService.delete).not.toHaveBeenCalled();
  });

  it('mantiene la visita completada en consulta sin corrección ni eliminación', () => {
    activateVisitContext({
      ...visitTask,
      estado: 'Completada',
      puede_realizar_acciones: false,
    });
    fixture.detectChanges();

    expect(component.canEditVisitLocation()).toBe(false);
    const card = fixture.nativeElement.querySelector('.map-detail-card') as HTMLElement;
    expect(card.textContent).toContain('Cómo llegar');
    expect(card.textContent).not.toContain('Corregir ubicación');
    expect(card.textContent).not.toContain('Eliminar');
  });

  it('oculta y bloquea Eliminar para usuarios no administradores', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const property = component.allItems()[0];
    component.selectItem(property);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.map-detail-card') as HTMLElement;
    expect(card.textContent).not.toContain('Eliminar');
    component.requestDelete(property);
    component.confirmDelete();
    expect(component.deleteConfirmation()).toBeNull();
    expect(locationsService.delete).not.toHaveBeenCalled();
    expect(antennasService.delete).not.toHaveBeenCalled();
  });

  it('confirma o cancela la eliminación con el nombre del registro', async () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const property = component.allItems()[0];
    component.selectItem(property);
    component.requestDelete(property);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.delete-confirmation-modal') as HTMLElement;
    expect(modal.textContent).toContain('Sergio Morales · Propiedad 1');
    expect(modal.textContent).toContain('cliente y sus demás propiedades se conservarán');
    expect(
      Array.from(modal.querySelectorAll('button')).map((button) => button.textContent?.trim()),
    ).toEqual(['Cancelar', 'Eliminar']);

    component.cancelDelete();
    expect(component.deleteConfirmation()).toBeNull();
    expect(component.selectedItem()).toBe(property);
    expect(locationsService.delete).not.toHaveBeenCalled();
  });

  it('elimina solo la propiedad confirmada y su marcador sin recargar', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const response = new Subject<void>();
    locationsService.delete.mockReturnValue(response.asObservable());
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const property = component.allItems()[0];
    component.selectItem(property);
    component.requestDelete(property);

    component.confirmDelete();
    component.confirmDelete();
    expect(locationsService.delete).toHaveBeenCalledTimes(1);
    expect(locationsService.delete).toHaveBeenCalledWith(11);

    response.next(undefined);
    response.complete();
    await vi.waitFor(() => expect(component.properties()).toHaveLength(2));

    expect(component.properties().map((item) => item.id_ubicacion)).toEqual([12, 13]);
    expect(component.antennas()).toEqual(antennas);
    expect(component.selectedItem()).toBeNull();
    expect(markerInstances[0].map).toBeNull();
    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(component.actionMessage()).toContain('eliminado correctamente');
  });

  it('elimina solo la antena confirmada y actualiza el mapa local', async () => {
    auth.isAdministrator.mockReturnValue(true);
    antennasService.delete.mockReturnValue(of(undefined));
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const antenna = component.allItems().find((item) => item.kind === 'antenna')!;
    component.selectItem(antenna);
    component.requestDelete(antenna);
    component.confirmDelete();
    await vi.waitFor(() => expect(component.antennas()).toEqual([]));

    expect(antennasService.delete).toHaveBeenCalledWith(8);
    expect(component.properties()).toEqual(properties);
    expect(component.selectedItem()).toBeNull();
    expect(markerInstances[2].map).toBeNull();
    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
  });

  it('conserva registro, marcador y confirmación cuando una relación impide eliminar', async () => {
    auth.isAdministrator.mockReturnValue(true);
    locationsService.delete.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              detail:
                'No se puede eliminar la propiedad porque está siendo utilizada por una visita técnica o instalación',
            },
          }),
      ),
    );
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const property = component.allItems()[0];
    component.selectItem(property);
    component.requestDelete(property);
    component.confirmDelete();

    expect(component.properties()).toEqual(properties);
    expect(component.deleteConfirmation()).toBe(property);
    expect(component.deleteError()).toContain('visita técnica o instalación');
    expect(component.selectedItem()).toBe(property);
    expect(markerInstances[0].map).not.toBeNull();
  });

  it('muestra el formulario horizontal con los textos y campos acordados', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.property-modal') as HTMLElement;
    expect(modal.textContent).toContain('UBICACIONES GEOGRÁFICAS');
    expect(modal.textContent).toContain('Agregar ubicación');
    expect(modal.textContent).toContain('Tipo de ubicación');
    expect(modal.textContent).toContain('Usar mi ubicación');
    expect(modal.textContent).toContain('Guardar ubicación');
    expect(modal.textContent).not.toContain('Registrar propiedad');
    expect(modal.textContent).not.toContain('Propiedades registradas');
    expect(modal.textContent).not.toContain('Observaciones');
    expect(modal.querySelector('#property-status')).toBeNull();

    const typeSelect = modal.querySelector('#location-type') as HTMLSelectElement;
    typeSelect.value = 'antenna';
    typeSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(modal.textContent).toContain('Nombre de la antena');
    expect(modal.textContent).not.toContain('Buscar antena existente');
    expect((modal.querySelector('#antenna-search') as HTMLInputElement).required).toBe(true);
  });

  it('abre el registro, muestra la numeración del cliente y agrega la respuesta sin recargar', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const created: UbicacionCliente = {
      ...properties[2],
      id_ubicacion: 14,
      id_cliente: 3,
      numero_propiedad: 3,
      nombre_cliente: 'Sergio Morales',
      direccion: 'Zona 2',
    };
    locationsService.create.mockReturnValue(of(created));
    fixture.detectChanges();
    component.prepareAddLocation();
    component.selectClient(clients[0]);
    component.selectedPropertyOption.set('new');
    component.propertyForm.patchValue({ direccion: 'Zona 2' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.property-modal')).not.toBeNull();
    expect(locationsService.getByClient).toHaveBeenCalledWith(3);
    expect(component.clientProperties().map((property) => property.numero_propiedad)).toEqual([
      1, 2,
    ]);
    component.saveLocation();
    await vi.waitFor(() => expect(component.properties()).toContain(created));

    expect(locationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id_cliente: 3,
        direccion: 'Zona 2',
        latitud: null,
        longitud: null,
      }),
      null,
    );
    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(component.isPropertyFormOpen()).toBe(false);
    expect(component.actionMessage()).toContain('Propiedad 3 registrada');
  });

  it('autocompleta departamento, municipio, dirección y referencia del cliente', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    component.selectClient(clients[0]);
    fixture.detectChanges();

    expect(clientsService.getDepartamentos).toHaveBeenCalledTimes(1);
    expect(component.selectedDepartmentName()).toBe('Guatemala');
    expect(component.selectedMunicipalityName()).toBe('Guatemala');
    expect(component.propertyForm.controls.direccion.value).toBe('Zona 1');
    expect(component.propertyForm.controls.referencia.value).toBe('');
    expect(
      (fixture.nativeElement.querySelector('#client-department') as HTMLInputElement).value,
    ).toBe('Guatemala');
    expect(
      (fixture.nativeElement.querySelector('#client-municipality') as HTMLInputElement).value,
    ).toBe('Guatemala');
  });

  it('prioriza la propiedad existente y conserva el borrador de Nueva propiedad', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    component.selectClient(clients[0]);
    const selector = document.createElement('select');
    selector.append(new Option('Nueva', 'new'), new Option('Propiedad 2', '12'));
    selector.value = 'new';
    component.onPropertySelection({ target: selector } as unknown as Event);
    component.propertyForm.patchValue({
      direccion: 'Dirección personalizada',
      referencia: 'Referencia personalizada',
    });

    selector.value = '12';
    component.onPropertySelection({ target: selector } as unknown as Event);
    expect(component.propertyForm.controls.direccion.value).toBe('Sector Sur');
    expect(component.propertyForm.controls.referencia.value).toBe('Portón azul');

    selector.value = 'new';
    component.onPropertySelection({ target: selector } as unknown as Event);
    expect(component.propertyForm.controls.direccion.value).toBe('Dirección personalizada');
    expect(component.propertyForm.controls.referencia.value).toBe('Referencia personalizada');
  });

  it('limpia la propiedad anterior y precarga los datos al cambiar de cliente', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    component.selectClient(clients[0]);
    component.selectedPropertyOption.set(12);
    component.editingProperty.set(properties[1]);

    component.selectClient(clients[1]);

    expect(locationsService.getByClient).toHaveBeenLastCalledWith(4);
    expect(component.selectedClient()).toBe(clients[1]);
    expect(component.selectedPropertyOption()).toBeNull();
    expect(component.editingProperty()).toBeNull();
    expect(component.propertyForm.controls.direccion.value).toBe('Avenida Central 4-20');
    expect(component.propertyForm.controls.referencia.value).toBe('Frente al parque');
    expect(component.selectedDepartmentName()).toBe('Quetzaltenango');
    expect(component.selectedMunicipalityName()).toBe('Quetzaltenango');
  });

  it('selecciona coordenadas sobre el mapa principal sin perder los datos del formulario', async () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    component.selectClient(clients[0]);
    component.propertyForm.patchValue({ direccion: 'Dirección conservada' });

    component.selectCoordinatesOnMap();
    expect(component.coordinateSelectionActive()).toBe(true);
    mapClickHandler?.({ latLng: { toJSON: () => ({ lat: 14.61234567, lng: -90.52345678 }) } });
    component.confirmCoordinates();

    expect(component.coordinates()).toEqual({ latitud: 14.6123457, longitud: -90.5234568 });
    expect(component.propertyForm.controls.direccion.value).toBe('Dirección conservada');
    expect(component.selectedClient()).toBe(clients[0]);
    expect(component.coordinateSelectionActive()).toBe(false);
    expect(mapCalls).toHaveLength(1);
  });

  it('cancela solamente el punto provisional y conserva las coordenadas confirmadas', async () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    component.coordinates.set({ latitud: 14.63, longitud: -90.5 });
    component.coordinateStatus.set('registered');
    component.propertyForm.patchValue({ referencia: 'Dato conservado' });

    component.selectCoordinatesOnMap();
    mapClickHandler?.({ latLng: { toJSON: () => ({ lat: 15.1, lng: -91.2 }) } });
    component.cancelCoordinateSelection();

    expect(component.coordinates()).toEqual({ latitud: 14.63, longitud: -90.5 });
    expect(component.coordinateStatus()).toBe('registered');
    expect(component.propertyForm.controls.referencia.value).toBe('Dato conservado');
    expect(locationsService.create).not.toHaveBeenCalled();
    expect(locationsService.update).not.toHaveBeenCalled();
  });

  it('obtiene GPS y exige confirmar el punto sobre el mapa principal', async () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    component.propertyForm.patchValue({ direccion: 'Dirección conservada' });

    component.useCurrentLocation();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
    geolocation.getCurrentPosition.mock.calls[0][0]({
      coords: { latitude: 14.61234567, longitude: -90.52345678, accuracy: 18.6 },
    } as GeolocationPosition);

    expect(component.coordinates()).toBeNull();
    expect(component.gpsAccuracy()).toBe(19);
    expect(component.selectionCoordinates()).toEqual({
      latitud: 14.6123457,
      longitud: -90.5234568,
    });
    expect(component.coordinateSelectionActive()).toBe(true);
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector('.coordinate-toolbar') as HTMLElement;
    expect(confirmation.textContent).toContain('CONFIRMAR UBICACIÓN');
    expect(confirmation.textContent).toContain('Precisión estimada: 19 m');
    expect(confirmation.textContent).toContain(
      'La ubicación detectada puede ser aproximada. Verifica el marcador antes de confirmar',
    );
    component.confirmCoordinates();
    fixture.detectChanges();
    expect(component.coordinates()).toEqual({ latitud: 14.6123457, longitud: -90.5234568 });
    expect(component.coordinateStatus()).toBe('selected');
    expect(fixture.nativeElement.textContent).toContain('Ubicación confirmada');
    expect(component.propertyForm.controls.direccion.value).toBe('Dirección conservada');
    expect(mapCalls).toHaveLength(1);
  });

  it('habilita Ubicación recibida al ingresar un enlace', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    fixture.detectChanges();

    const methods = fixture.nativeElement.querySelectorAll(
      '.location-methods button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(Array.from(methods).map((button) => button.textContent?.trim())).toEqual([
      'Usar mi ubicación',
      'Seleccionar en mapa',
      'Ubicación recibida',
    ]);
    methods[2].click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.received-location-panel') as HTMLElement;
    expect(panel.textContent).toContain('Enlace de Google Maps');
    expect((panel.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    const input = panel.querySelector('input') as HTMLInputElement;
    input.value = 'https://maps.app.goo.gl/aiYZUsrRzUrRnzqWA?g_st=aw';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((panel.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('resuelve el enlace corto, bloquea duplicados y reutiliza la confirmación principal', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const response = new Subject<{ latitud: number; longitud: number }>();
    locationsService.resolveGoogleMapsLink.mockReturnValue(response.asObservable());
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    component.propertyForm.patchValue({ direccion: 'Dirección conservada' });
    component.coordinates.set({ latitud: 14.6, longitud: -90.5 });
    component.receivedLocationOpen.set(true);
    component.receivedLocationUrl.set('https://maps.app.goo.gl/aiYZUsrRzUrRnzqWA?g_st=aw');

    component.obtainReceivedCoordinates();
    component.obtainReceivedCoordinates();

    expect(locationsService.resolveGoogleMapsLink).toHaveBeenCalledTimes(1);
    expect(locationsService.resolveGoogleMapsLink).toHaveBeenCalledWith(
      'https://maps.app.goo.gl/aiYZUsrRzUrRnzqWA?g_st=aw',
    );
    expect(component.isResolvingReceivedLocation()).toBe(true);
    expect(component.canProcessReceivedLocation()).toBe(false);
    expect(component.coordinates()).toEqual({ latitud: 14.6, longitud: -90.5 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Obteniendo coordenadas...');

    response.next({ latitud: 14.6123457, longitud: -90.5234568 });
    response.complete();

    expect(component.isResolvingReceivedLocation()).toBe(false);
    expect(component.coordinates()).toEqual({ latitud: 14.6, longitud: -90.5 });
    expect(component.selectionCoordinates()).toEqual({
      latitud: 14.6123457,
      longitud: -90.5234568,
    });
    expect(component.coordinateSelectionActive()).toBe(true);
    expect(markerCalls.at(-1)?.title).toBe('Ubicación geográfica provisional');
    expect(component.propertyForm.controls.direccion.value).toBe('Dirección conservada');
    expect(locationsService.create).not.toHaveBeenCalled();
    expect(locationsService.update).not.toHaveBeenCalled();

    mapClickHandler?.({ latLng: { toJSON: () => ({ lat: 14.61, lng: -90.52 }) } });
    component.confirmCoordinates();
    expect(component.coordinates()).toEqual({ latitud: 14.61, longitud: -90.52 });
    expect(component.receivedLocationUrl()).toContain('maps.app.goo.gl');
    expect(locationsService.create).not.toHaveBeenCalled();
  });

  it('muestra los errores HTTP del endpoint y conserva formulario y coordenadas', () => {
    component.propertyForm.patchValue({ direccion: 'Dirección conservada' });
    component.coordinates.set({ latitud: 14.6, longitud: -90.5 });
    component.receivedLocationUrl.set('https://maps.app.goo.gl/enlace');
    const cases = [
      [
        400,
        'El enlace de Google Maps no es válido o seguro',
        'El enlace de Google Maps no es válido o seguro',
      ],
      [401, 'Token inválido o expirado', 'Tu sesión expiró. Inicia sesión nuevamente.'],
      [
        403,
        'No tienes permisos para acceder a este módulo',
        'No tienes permisos para realizar esta acción.',
      ],
      [
        422,
        'El enlace no contiene coordenadas explícitas y verificables',
        'El enlace no contiene coordenadas explícitas y verificables',
      ],
      [502, 'No se pudo resolver el enlace', 'No fue posible resolver el enlace de Google Maps.'],
      [504, 'Google Maps no respondió', 'La obtención de coordenadas agotó el tiempo de espera.'],
    ] as const;

    for (const [status, detail, expected] of cases) {
      locationsService.resolveGoogleMapsLink.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status, error: { detail } })),
      );
      component.obtainReceivedCoordinates();
      expect(component.receivedLocationError()).toBe(expected);
      expect(component.coordinates()).toEqual({ latitud: 14.6, longitud: -90.5 });
      expect(component.propertyForm.controls.direccion.value).toBe('Dirección conservada');
    }

    expect(component.coordinateSelectionActive()).toBe(false);
    expect(locationsService.create).not.toHaveBeenCalled();
    expect(locationsService.update).not.toHaveBeenCalled();
  });

  it('informa cuando el navegador rechaza el permiso de ubicación', async () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();

    component.useCurrentLocation();
    geolocation.getCurrentPosition.mock.calls[0][1]({ code: 1 } as GeolocationPositionError);

    expect(component.geolocationError()).toBe('No se otorgó permiso para acceder a la ubicación.');
    expect(component.coordinateSelectionActive()).toBe(false);
  });

  it('edita datos y quita la fachada mediante los endpoints existentes', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const updated: UbicacionCliente = {
      ...properties[1],
      direccion: 'Dirección corregida',
    };
    const withoutPhoto: UbicacionCliente = { ...updated, foto_fachada: null };
    locationsService.update.mockReturnValue(of(updated));
    locationsService.removePhoto.mockReturnValue(of(withoutPhoto));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.properties()).toHaveLength(3));

    component.editProperty(component.allItems()[1] as PropertyMapItem);
    component.propertyForm.patchValue({ direccion: 'Dirección corregida' });
    component.removeFacade();
    component.saveLocation();
    await vi.waitFor(() =>
      expect(component.properties()[1]).toEqual(expect.objectContaining({ foto_fachada: null })),
    );

    expect(locationsService.update).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ direccion: 'Dirección corregida', estado: 'Activo' }),
    );
    expect(locationsService.removePhoto).toHaveBeenCalledWith(12);
    expect(locationsService.create).not.toHaveBeenCalled();
    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ kind: 'property', idUbicacion: 12 }),
    );
  });

  it('selecciona y actualiza una antena existente sin crear otra', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const updated: Antena = {
      ...antennas[0],
      direccion_sector: 'Sector actualizado',
      latitud: 14.66,
      longitud: -90.49,
    };
    antennasService.update.mockReturnValue(of(updated));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.antennas()).toHaveLength(1));
    component.prepareAddLocation();
    const typeSelect = document.createElement('select');
    const antennaOption = document.createElement('option');
    antennaOption.value = 'antenna';
    typeSelect.append(antennaOption);
    typeSelect.value = 'antenna';
    component.onLocationTypeChange({ target: typeSelect } as unknown as Event);
    component.selectAntenna(antennas[0]);
    component.propertyForm.patchValue({ direccion: 'Sector actualizado' });
    component.coordinates.set({ latitud: 14.66, longitud: -90.49 });

    component.saveLocation();
    await vi.waitFor(() => expect(component.antennas()[0]).toEqual(updated));

    expect(antennasService.getById).toHaveBeenCalledWith(8);
    expect(antennasService.update).toHaveBeenCalledWith(8, {
      direccion_sector: 'Sector actualizado',
      referencia: null,
      latitud: 14.66,
      longitud: -90.49,
    });
    expect(antennasService.create).not.toHaveBeenCalled();
    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ kind: 'antenna', id: 8, address: 'Sector actualizado' }),
    );
    expect(component.actionMessage()).toContain('Torre Norte');
  });

  it('registra una antena nueva con fotografía sin selección previa ni recarga', async () => {
    auth.isAdministrator.mockReturnValue(true);
    const response = new Subject<Antena>();
    const photo = new File(['foto'], 'sitio.png', { type: 'image/png' });
    const created: Antena = {
      id_antena: 9,
      nombre: 'Torre Sur',
      latitud: 14.61,
      longitud: -90.52,
      direccion_sector: 'Zona 2',
      referencia: 'Junto al tanque',
      foto_antena: '/uploads/antenas/antena_9.webp',
      estado: 'Activa',
    };
    antennasService.create.mockReturnValue(response.asObservable());
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    const typeSelect = document.createElement('select');
    typeSelect.append(new Option('Antena', 'antenna'));
    typeSelect.value = 'antenna';
    component.onLocationTypeChange({ target: typeSelect } as unknown as Event);
    const nameInput = document.createElement('input');
    nameInput.value = '  Torre Sur  ';
    component.onAntennaSearch({ target: nameInput } as unknown as Event);
    component.propertyForm.patchValue({
      direccion: 'Zona 2',
      referencia: 'Junto al tanque',
    });
    component.coordinates.set({ latitud: 14.61, longitud: -90.52 });
    component.facadeFile.set(photo);

    component.saveLocation();
    component.saveLocation();

    expect(antennasService.create).toHaveBeenCalledTimes(1);
    expect(antennasService.create).toHaveBeenCalledWith(
      {
        nombre: 'Torre Sur',
        direccion_sector: 'Zona 2',
        referencia: 'Junto al tanque',
        latitud: 14.61,
        longitud: -90.52,
        estado: 'Activa',
      },
      photo,
    );
    expect(antennasService.getById).not.toHaveBeenCalled();
    expect(antennasService.update).not.toHaveBeenCalled();

    response.next(created);
    response.complete();
    await vi.waitFor(() => expect(component.antennas()).toContain(created));

    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
    expect(markerCalls.at(-1)?.title).toBe('Torre Sur · Antena');
    expect(component.selectedItem()).toEqual(expect.objectContaining({ kind: 'antenna', id: 9 }));
    expect(component.actionMessage()).toBe('Antena Torre Sur registrada correctamente.');
    expect(component.isPropertyFormOpen()).toBe(false);
  });

  it('exige nombre y coordenadas para registrar una antena', () => {
    auth.isAdministrator.mockReturnValue(true);
    fixture.detectChanges();
    component.prepareAddLocation();
    const typeSelect = document.createElement('select');
    typeSelect.append(new Option('Antena', 'antenna'));
    typeSelect.value = 'antenna';
    component.onLocationTypeChange({ target: typeSelect } as unknown as Event);

    component.saveLocation();
    expect(component.propertyFormError()).toContain('nombre de la antena es obligatorio');
    expect(antennasService.create).not.toHaveBeenCalled();

    const nameInput = document.createElement('input');
    nameInput.value = 'Torre sin coordenadas';
    component.onAntennaSearch({ target: nameInput } as unknown as Event);
    component.saveLocation();
    expect(component.propertyFormError()).toContain('coordenadas geográficas válidas');
    expect(antennasService.create).not.toHaveBeenCalled();
  });

  it('carga ambas fuentes una vez y crea un marcador por ubicación válida', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));

    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(component.allItems().filter((item) => item.kind === 'property')).toHaveLength(3);
    expect(component.visibleItems().filter((item) => item.kind === 'property')).toHaveLength(2);
    expect(markerCalls.map((call) => call.title)).toEqual([
      'Sergio Morales · Propiedad 1',
      'Sergio Morales · Propiedad 2',
      'Torre Norte · Antena',
    ]);
    expect(mapCalls).toEqual([expect.objectContaining({ mapTypeId: 'roadmap' })]);
  });

  it('centra la vista inicial una sola vez después de cargar todos los registros', async () => {
    const propertiesResponse = new Subject<UbicacionCliente[]>();
    const antennasResponse = new Subject<Antena[]>();
    locationsService.getAll.mockReturnValue(propertiesResponse);
    antennasService.getAll.mockReturnValue(antennasResponse);
    fixture.detectChanges();
    await vi.waitFor(() => expect(mapCalls).toHaveLength(1));

    propertiesResponse.next(properties);
    propertiesResponse.complete();
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();

    antennasResponse.next(antennas);
    antennasResponse.complete();
    await vi.waitFor(() => expect(mapSetCenter).toHaveBeenCalledTimes(1));

    const center = mapSetCenter.mock.calls[0][0] as { lat: number; lng: number };
    expect(center.lat).toBeCloseTo(14.63);
    expect(center.lng).toBeCloseTo(-90.5);
    expect(mapSetZoom).toHaveBeenCalledOnce();
    expect(mapSetZoom).toHaveBeenCalledWith(12);
    expect(markerCalls).toHaveLength(3);
  });

  it('usa una única ubicación con zoom inicial moderado', async () => {
    locationsService.getAll.mockReturnValue(of([properties[0]]));
    antennasService.getAll.mockReturnValue(of([]));
    fixture.detectChanges();
    await vi.waitFor(() => expect(mapSetCenter).toHaveBeenCalledTimes(1));

    expect(mapSetCenter).toHaveBeenCalledWith({ lat: 14.63, lng: -90.5 });
    expect(mapSetZoom).toHaveBeenCalledWith(12);
    expect(markerCalls).toHaveLength(1);
  });

  it('conserva la vista predeterminada cuando no existen ubicaciones válidas', async () => {
    locationsService.getAll.mockReturnValue(of([]));
    antennasService.getAll.mockReturnValue(of([]));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.isLoadingMap()).toBe(false));

    expect(mapCalls[0]).toEqual(
      expect.objectContaining({ center: { lat: 14.6349, lng: -90.5069 }, zoom: 12 }),
    );
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();
    expect(markerCalls).toHaveLength(0);
  });

  it('respeta una cámara navegada antes de terminar la carga inicial', async () => {
    const propertiesResponse = new Subject<UbicacionCliente[]>();
    const antennasResponse = new Subject<Antena[]>();
    locationsService.getAll.mockReturnValue(propertiesResponse);
    antennasService.getAll.mockReturnValue(antennasResponse);
    fixture.detectChanges();
    await vi.waitFor(() => expect(mapCalls).toHaveLength(1));
    mapCenter = { lat: 15.1, lng: -91.2 };
    mapZoom = 14;

    propertiesResponse.next(properties);
    propertiesResponse.complete();
    antennasResponse.next(antennas);
    antennasResponse.complete();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));

    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();
    expect(mapCenter).toEqual({ lat: 15.1, lng: -91.2 });
    expect(mapZoom).toBe(14);
  });

  it('cambia entre Mapa, Satélite y Relieve sin reiniciar el mapa ni perder estado', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    markerHandlers[1]();
    component.setFilter('clients');
    const input = document.createElement('input');
    input.value = 'Sergio Morales';
    component.onSearch({ target: input } as unknown as Event);
    const centerCalls = mapSetCenter.mock.calls.length;
    const zoomCalls = mapSetZoom.mock.calls.length;

    component.setMapType('satellite');
    component.setMapType('terrain');
    component.setMapType('roadmap');
    fixture.detectChanges();

    expect(mapSetMapTypeId.mock.calls.map(([mapType]) => mapType)).toEqual([
      'satellite',
      'terrain',
      'roadmap',
    ]);
    expect(mapCalls).toHaveLength(1);
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(markerCalls).toHaveLength(3);
    expect(mapSetCenter).toHaveBeenCalledTimes(centerCalls);
    expect(mapSetZoom).toHaveBeenCalledTimes(zoomCalls);
    expect(component.filter()).toBe('clients');
    expect(component.searchTerm()).toBe('Sergio Morales');
    expect(component.selectedItem()).toEqual(expect.objectContaining({ id: 12 }));
    expect((markerCalls[1].content as HTMLElement).getAttribute('aria-current')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('.map-detail-card')).toHaveLength(1);
  });

  it('mantiene las tres vistas y acciones visibles durante la selección provisional', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.prepareAddLocation();
    component.selectCoordinatesOnMap();
    mapClickHandler?.({ latLng: { toJSON: () => ({ lat: 14.62, lng: -90.51 }) } });
    const markerCount = markerCalls.length;
    const centerCalls = mapSetCenter.mock.calls.length;
    const zoomCalls = mapSetZoom.mock.calls.length;
    fixture.detectChanges();

    const selector = fixture.nativeElement.querySelector('.map-view-selector') as HTMLElement;
    const confirmation = fixture.nativeElement.querySelector('.coordinate-toolbar') as HTMLElement;
    expect(selector.textContent).toContain('Mapa');
    expect(selector.textContent).toContain('Satélite');
    expect(selector.textContent).toContain('Relieve');
    expect(confirmation.textContent).toContain('Cancelar');
    expect(confirmation.textContent).toContain('Confirmar ubicación');

    component.setMapType('satellite');
    component.setMapType('terrain');
    fixture.detectChanges();

    const active = selector.querySelector('.active') as HTMLButtonElement;
    expect(active.textContent?.trim()).toBe('Relieve');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(component.coordinateSelectionActive()).toBe(true);
    expect(component.selectionCoordinates()).toEqual({ latitud: 14.62, longitud: -90.51 });
    expect(markerCalls).toHaveLength(markerCount);
    expect(mapSetCenter).toHaveBeenCalledTimes(centerCalls);
    expect(mapSetZoom).toHaveBeenCalledTimes(zoomCalls);
    expect(mapSetMapTypeId.mock.calls.map(([mapType]) => mapType)).toEqual([
      'satellite',
      'terrain',
    ]);
    component.setMapType('terrain');
    expect(mapSetMapTypeId).toHaveBeenCalledTimes(2);
  });

  it('combina filtros sin repetir llamadas HTTP', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    mapSetCenter.mockClear();
    mapSetZoom.mockClear();

    expect(component.visibleItems()).toHaveLength(3);
    component.setFilter('clients');
    expect(component.visibleItems()).toHaveLength(2);
    expect(markerCalls).toHaveLength(3);
    expect(markerInstances[2].map).toBeNull();
    component.setFilter('antennas');
    expect(component.visibleItems()).toHaveLength(1);
    expect(component.visibleItems()[0].kind).toBe('antenna');
    expect(markerCalls).toHaveLength(3);
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();
    expect(locationsService.getAll).toHaveBeenCalledTimes(1);
    expect(antennasService.getAll).toHaveBeenCalledTimes(1);
  });

  it('busca por propiedad, dirección, antena y referencia', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    mapSetCenter.mockClear();
    mapSetZoom.mockClear();

    const input = document.createElement('input');
    input.value = 'Propiedad 2 portón azul';
    component.onSearch({ target: input } as unknown as Event);
    expect(component.visibleItems().map((item) => item.id)).toEqual([12]);

    input.value = 'Torre Norte';
    component.onSearch({ target: input } as unknown as Event);
    expect(component.visibleItems().map((item) => item.id)).toEqual([8]);
    expect(markerCalls).toHaveLength(3);
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();
  });

  it('distingue propiedades del mismo cliente y selecciona su marcador sin recrearlo', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    const input = document.createElement('input');
    input.value = 'Sergio Morales';
    component.onSearch({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.searchResults().map((item) => item.subtitle)).toEqual([
      'Propiedad 1',
      'Propiedad 2',
    ]);
    component.selectSearchResult(component.searchResults()[1]);
    fixture.detectChanges();

    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ id: 12, subtitle: 'Propiedad 2' }),
    );
    expect(mapSetCenter).toHaveBeenCalledWith({ lat: 14.61, lng: -90.52 });
    expect(mapSetZoom).toHaveBeenCalledWith(17);
    expect((markerCalls[1].content as HTMLElement).getAttribute('aria-current')).toBe('true');
    expect(markerCalls).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Propiedad 2');
  });

  it('selecciona una antena, centra su marcador y reemplaza la información abierta', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    component.selectItem(component.allItems()[0]);
    component.selectSearchResult(component.allItems().find((item) => item.kind === 'antenna')!);
    fixture.detectChanges();

    expect(component.selectedItem()).toEqual(
      expect.objectContaining({ kind: 'antenna', title: 'Torre Norte' }),
    );
    expect(mapSetCenter).toHaveBeenLastCalledWith({ lat: 14.65, lng: -90.48 });
    expect(mapSetZoom).toHaveBeenLastCalledWith(16);
    expect((markerCalls[0].content as HTMLElement).getAttribute('aria-current')).toBe('false');
    expect((markerCalls[2].content as HTMLElement).getAttribute('aria-current')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('.map-detail-card')).toHaveLength(1);
  });

  it('abre indicaciones de Google Maps para propiedades y antenas sin fijar origen', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fixture.detectChanges();
    const property = component
      .allItems()
      .find((item) => item.kind === 'property' && item.id === 11)!;
    const antenna = component.allItems().find((item) => item.kind === 'antenna')!;

    component.prepareDirections(property);
    component.prepareDirections(antenna);

    expect(open).toHaveBeenNthCalledWith(
      1,
      'https://www.google.com/maps/dir/?api=1&destination=14.63%2C-90.5&travelmode=driving',
      '_blank',
      'noopener,noreferrer',
    );
    expect(open).toHaveBeenNthCalledWith(
      2,
      'https://www.google.com/maps/dir/?api=1&destination=14.65%2C-90.48&travelmode=driving',
      '_blank',
      'noopener,noreferrer',
    );
    expect(open.mock.calls.every(([url]) => !String(url).includes('origin='))).toBe(true);
    open.mockRestore();
  });

  it('no abre indicaciones cuando las coordenadas son inválidas', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fixture.detectChanges();
    const invalid = { ...component.allItems()[0], latitude: 91 };

    component.prepareDirections(invalid);

    expect(open).not.toHaveBeenCalled();
    expect(component.actionMessage()).toContain('no está disponible');
    open.mockRestore();
  });

  it('informa una propiedad sin coordenadas sin intentar mover la cámara', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(markerCalls).toHaveLength(3));
    mapSetCenter.mockClear();
    mapSetZoom.mockClear();
    const property = component.allItems().find((item) => item.id === 13)!;

    component.selectSearchResult(property);
    fixture.detectChanges();

    expect(component.selectedItem()).toBe(property);
    expect(component.actionMessage()).toContain('no tiene coordenadas registradas');
    expect(mapSetCenter).not.toHaveBeenCalled();
    expect(mapSetZoom).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
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

  it('mantiene antenas visibles cuando falla la carga de propiedades', async () => {
    locationsService.getAll.mockReturnValue(throwError(() => new Error('fallo propiedades')));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.antennas()).toHaveLength(1));

    expect(component.properties()).toEqual([]);
    expect(component.propertiesError()).toContain('Propiedades:');
    expect(component.antennasError()).toBe('');
    expect(component.visibleItems()).toHaveLength(1);
    expect(component.visibleItems()[0].kind).toBe('antenna');
  });

  it('mantiene propiedades visibles cuando falla la carga de antenas', async () => {
    antennasService.getAll.mockReturnValue(throwError(() => new Error('fallo antenas')));
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.properties()).toHaveLength(3));

    expect(component.antennas()).toEqual([]);
    expect(component.antennasError()).toContain('Antenas:');
    expect(component.propertiesError()).toBe('');
    expect(component.allItems()).toHaveLength(3);
    expect(component.visibleItems()).toHaveLength(2);
  });

  it('cancela respuestas pendientes al destruir el componente', () => {
    const propertiesResponse = new Subject<UbicacionCliente[]>();
    const antennasResponse = new Subject<Antena[]>();
    locationsService.getAll.mockReturnValue(propertiesResponse);
    antennasService.getAll.mockReturnValue(antennasResponse);
    fixture.detectChanges();

    expect(propertiesResponse.observed).toBe(true);
    expect(antennasResponse.observed).toBe(true);
    fixture.destroy();
    propertiesResponse.next(properties);
    antennasResponse.next(antennas);

    expect(propertiesResponse.observed).toBe(false);
    expect(antennasResponse.observed).toBe(false);
    expect(component.properties()).toEqual([]);
    expect(component.antennas()).toEqual([]);
  });

  it('reintenta la inicialización del mapa después de un fallo', async () => {
    loader.load.mockRejectedValueOnce(new Error('Fallo transitorio')).mockResolvedValueOnce({
      mapId: 'test-map-id',
      Map: class {
        addListener(): { remove: () => void } {
          return { remove: vi.fn() };
        }
        getCenter(): { toJSON: () => { lat: number; lng: number } } {
          return { toJSON: () => ({ lat: 14.6349, lng: -90.5069 }) };
        }
        getZoom(): number {
          return 12;
        }
        setCenter(): void {}
        setZoom(): void {}
        setMapTypeId(): void {}
      },
      AdvancedMarkerElement: class {
        map = null;
        position = null;
        addListener(): { remove: () => void } {
          return { remove: vi.fn() };
        }
      },
    });
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.mapError()).toBe('Fallo transitorio'));

    component.retryMap();
    await vi.waitFor(() => expect(component.isLoadingMap()).toBe(false));

    expect(loader.load).toHaveBeenCalledTimes(2);
    expect(component.mapError()).toBe('');
  });
});
