import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { Tarea } from '../../core/models/tarea.models';
import { GoogleMapsLoaderService } from '../../core/services/google-maps-loader.service';
import { TareasService } from '../../core/services/tareas.service';
import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { TareaTecnicaRow, TareasComponent } from './tareas.component';

describe('TareasComponent', () => {
  let fixture: ComponentFixture<TareasComponent>;
  let component: TareasComponent;
  let tareasService: { getAll: ReturnType<typeof vi.fn> };
  let geolocation: { getCurrentPosition: ReturnType<typeof vi.fn> };
  let mapsLoader: { load: ReturnType<typeof vi.fn> };
  let visitasService: {
    getById: ReturnType<typeof vi.fn>;
    getEvaluation: ReturnType<typeof vi.fn>;
    registerFirstLocation: ReturnType<typeof vi.fn>;
    startEvaluation: ReturnType<typeof vi.fn>;
    finishEvaluation: ReturnType<typeof vi.fn>;
  };

  const apiTasks: Tarea[] = [
    {
      id: 3,
      tipo: 'Instalación',
      id_visita: 12,
      id_instalacion: 3,
      id_cliente: 8,
      id_ubicacion: 44,
      numero_propiedad: 2,
      direccion_propiedad: 'Sector Norte',
      referencia_propiedad: 'Frente al parque',
      foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_44.webp',
      latitud: 14.6349142,
      longitud: -90.5068824,
      cliente: 'Cliente instalación',
      fecha: '2099-09-21',
      hora: '08:00:00',
      descripcion: 'Instalar enlace',
      estado: 'Programada',
      id_tipo_instalacion: 2,
      tipo_instalacion: 'Internet',
      tecnicos: [{ id_empleado: 9, codigo: 'EMP-0009', nombre: 'Ana Técnica', es_encargado: true }],
      ubicacion_disponible: true,
      puede_ver: true,
      puede_realizar_acciones: false,
      es_responsable: true,
      bloqueada: false,
    },
    {
      id: 15,
      tipo: 'Visita Técnica',
      id_visita: 15,
      id_instalacion: null,
      id_cliente: 4,
      id_ubicacion: null,
      numero_propiedad: null,
      direccion_propiedad: null,
      referencia_propiedad: null,
      foto_fachada: null,
      latitud: null,
      longitud: null,
      cliente: 'María López',
      fecha: '2099-09-21',
      hora: '09:30:00',
      descripcion: 'Evaluación previa',
      estado: 'Programada',
      id_tipo_instalacion: 2,
      tipo_instalacion: 'Internet',
      tecnicos: [
        { id_empleado: 7, codigo: 'EMP-0007', nombre: 'Carlos Pérez', es_encargado: true },
      ],
      ubicacion_disponible: false,
      puede_ver: true,
      puede_realizar_acciones: true,
      es_responsable: true,
      bloqueada: false,
    },
  ];

  beforeEach(async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('blob:facade-photo'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    geolocation = { getCurrentPosition: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation,
    });
    class MockMap {
      addListener(): { remove: () => void } {
        return { remove: vi.fn() };
      }
    }
    class MockMarker {
      map;
      position;

      constructor(options: { map: unknown; position: { lat: number; lng: number } }) {
        this.map = options.map;
        this.position = options.position;
      }
    }
    mapsLoader = {
      load: vi.fn().mockResolvedValue({
        Map: MockMap,
        AdvancedMarkerElement: MockMarker,
      }),
    };
    tareasService = { getAll: vi.fn().mockReturnValue(of([])) };
    visitasService = {
      getById: vi.fn().mockReturnValue(
        of({
          id_visita: 15,
          id_cliente: 4,
          id_ubicacion: null,
          numero_propiedad: null,
          nombre_cliente: 'María López',
          telefono_cliente: '55551234',
          direccion_cliente: 'Zona 1',
          id_empleado: 7,
          nombre_tecnico: 'Carlos Pérez',
          id_tipo_instalacion: 2,
          nombre_tipo_instalacion: 'Internet',
          fecha_programada: '2099-09-21',
          hora_programada: '09:30:00',
          motivo_visita: 'Evaluación previa',
          foto_referencia: null,
          indicaciones: null,
          observaciones: null,
          estado: 'Programada',
          evaluacion: null,
        }),
      ),
      getEvaluation: vi.fn().mockReturnValue(
        of({
          id_evaluacion: 3,
          id_visita: 15,
          descripcion_trabajo: 'Instalar enlace',
          tecnicos_recomendados: 2,
          condiciones_lugar: 'Acceso alto',
          observacion_tecnica: 'Factible',
          materiales: [],
        }),
      ),
      registerFirstLocation: vi.fn().mockReturnValue(
        of({
          id_ubicacion: 31,
          id_cliente: 4,
          numero_propiedad: 1,
          nombre_cliente: 'María López',
          direccion: 'Sector Norte',
          latitud: null,
          longitud: null,
          foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_31.webp',
          referencia: 'Frente al parque',
          observaciones: 'Portón azul',
          estado: 'Activo',
          fecha_registro: '2026-10-02T10:00:00',
        }),
      ),
      startEvaluation: vi.fn(),
      finishEvaluation: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [TareasComponent],
      providers: [
        { provide: TareasService, useValue: tareasService },
        { provide: VisitasTecnicasService, useValue: visitasService },
        { provide: GoogleMapsLoaderService, useValue: mapsLoader },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TareasComponent);
    component = fixture.componentInstance;
  });

  it('adapta visitas e instalaciones del endpoint unificado con sus IDs de origen', () => {
    tareasService.getAll.mockReturnValue(of(apiTasks));

    fixture.detectChanges();

    expect(tareasService.getAll).toHaveBeenCalledTimes(1);
    expect(component.tasks()).toHaveLength(2);
    expect(component.tasks()[0]).toEqual(
      expect.objectContaining({
        id: 3,
        id_visita: 12,
        id_instalacion: 3,
        id_ubicacion: 44,
        numeroPropiedad: 2,
        tecnico: 'Ana Técnica',
      }),
    );
    expect(component.tasks()[1]).toEqual(
      expect.objectContaining({
        id: 15,
        id_visita: 15,
        id_instalacion: null,
        id_cliente: 4,
        id_empleado: 7,
        id_tipo_instalacion: 2,
        cliente: 'María López',
        tipoInstalacion: 'Internet',
        tecnico: 'Carlos Pérez',
        fecha: '2099-09-21',
        hora: '09:30',
        estado: 'Programada',
      }),
    );
    expect(fixture.nativeElement.textContent).toContain('Realizar evaluación');
  });

  it('visita sin propiedad muestra el aviso y Registrar ubicación', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación no registrada');
    expect(fixture.nativeElement.textContent).toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
  });

  it('abre y cierra el formulario únicamente para una visita sin propiedad', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));
    fixture.detectChanges();
    const taskWithoutLocation = component.tasks()[0];

    component.openLocationRegistration(taskWithoutLocation);
    fixture.detectChanges();
    expect(component.visitForLocation()?.id_visita).toBe(15);
    expect(fixture.nativeElement.querySelector('.location-modal')).toBeTruthy();

    component.closeLocationRegistration();
    fixture.detectChanges();
    expect(component.visitForLocation()).toBeNull();
    expect(fixture.nativeElement.querySelector('.location-modal')).toBeNull();

    component.openLocationRegistration({
      ...taskWithoutLocation,
      id_ubicacion: 31,
      numeroPropiedad: 1,
    });
    expect(component.visitForLocation()).toBeNull();
  });

  it('envía campos y fachada y actualiza la tarea sin recargar', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));
    fixture.detectChanges();
    component.openLocationRegistration(component.tasks()[0]);
    component.locationAddress.set('Sector Norte');
    component.locationReference.set('Frente al parque');
    component.locationObservations.set('Portón azul');
    const photo = new File(['image'], 'fachada.png', { type: 'image/png' });
    component.facadePhoto.set(photo);

    component.submitLocation(new Event('submit'));
    fixture.detectChanges();

    expect(visitasService.registerFirstLocation).toHaveBeenCalledWith(
      15,
      {
        direccion: 'Sector Norte',
        referencia: 'Frente al parque',
        observaciones: 'Portón azul',
      },
      photo,
    );
    expect(tareasService.getAll).toHaveBeenCalledTimes(1);
    expect(component.tasks()[0]).toEqual(
      expect.objectContaining({
        id_ubicacion: 31,
        numeroPropiedad: 1,
        direccionPropiedad: 'Sector Norte',
        referenciaPropiedad: 'Frente al parque',
      }),
    );
    expect(component.visitForLocation()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 1');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).toContain('Realizar evaluación');
  });

  it('muestra preview cuadrado de la fotografía de fachada', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));
    fixture.detectChanges();
    component.openLocationRegistration(component.tasks()[0]);
    const photo = new File(['image'], 'fachada.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: { item: (index: number) => (index === 0 ? photo : null), length: 1, 0: photo },
    });

    component.onFacadePhotoChange({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.facadePreviewUrl()).toBe('blob:facade-photo');
    expect(fixture.nativeElement.querySelector('.facade-selector img')).toBeTruthy();
  });

  it('GPS exitoso abre el mapa sin guardar automáticamente', () => {
    openLocationForm();

    component.useCurrentLocation();
    expect(component.isCapturingLocation()).toBe(true);
    expect(visitasService.registerFirstLocation).not.toHaveBeenCalled();
    const call = geolocation.getCurrentPosition.mock.calls[0];
    expect(call[2]).toEqual({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    call[0]({
      coords: { latitude: 14.634914234, longitude: -90.506882456 },
    } as GeolocationPosition);
    fixture.detectChanges();

    expect(component.propertyMapMode()).toBe('select');
    expect(component.propertyMapCoordinates()).toEqual({
      latitud: 14.6349142,
      longitud: -90.5068825,
    });
    expect(component.capturedLatitude()).toBeNull();
    expect(component.isCapturingLocation()).toBe(false);
    expect(visitasService.registerFirstLocation).not.toHaveBeenCalled();

    component.confirmMapCoordinates(component.propertyMapCoordinates()!);
    fixture.detectChanges();
    expect(component.capturedLatitude()).toBe(14.6349142);
    expect(component.capturedLongitude()).toBe(-90.5068825);
    expect(component.geolocationMessage()).toBe('Ubicación obtenida');
    expect(fixture.nativeElement.textContent).toContain('✓ Ubicación obtenida');
  });

  it('muestra estado de carga mientras el navegador obtiene la ubicación', () => {
    openLocationForm();

    component.useCurrentLocation();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Obteniendo ubicación...');
    const button = fixture.nativeElement.querySelector(
      '.geolocation-field button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('informa cuando el navegador no soporta geolocalización', () => {
    openLocationForm();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });

    component.useCurrentLocation();

    expect(component.geolocationError()).toBe(
      'Este navegador no permite obtener la ubicación del dispositivo.',
    );
    expect(visitasService.registerFirstLocation).not.toHaveBeenCalled();
  });

  it('distingue permiso denegado, ubicación no disponible y timeout', () => {
    openLocationForm();
    const errors = [
      [1, 'No se otorgó permiso para acceder a la ubicación.'],
      [2, 'No fue posible determinar la ubicación del dispositivo.'],
      [3, 'La obtención de la ubicación tardó demasiado.'],
    ] as const;

    for (const [code, message] of errors) {
      component.useCurrentLocation();
      const call = geolocation.getCurrentPosition.mock.calls.at(-1)!;
      call[1]({ code } as GeolocationPositionError);
      expect(component.geolocationError()).toBe(message);
      expect(component.capturedLatitude()).toBeNull();
      expect(component.capturedLongitude()).toBeNull();
      expect(component.isCapturingLocation()).toBe(false);
    }
  });

  it('permite reintentar después de un error y conserva los demás campos', () => {
    openLocationForm();
    component.locationAddress.set('Sector Norte');
    component.locationReference.set('Frente al parque');
    component.locationObservations.set('Portón azul');
    const photo = new File(['image'], 'fachada.png', { type: 'image/png' });
    component.facadePhoto.set(photo);

    component.useCurrentLocation();
    geolocation.getCurrentPosition.mock.calls[0][1]({ code: 1 } as GeolocationPositionError);
    component.useCurrentLocation();
    geolocation.getCurrentPosition.mock.calls[1][0]({
      coords: { latitude: 14.6, longitude: -90.5 },
    } as GeolocationPosition);
    component.confirmMapCoordinates(component.propertyMapCoordinates()!);

    expect(component.capturedLatitude()).toBe(14.6);
    expect(component.locationAddress()).toBe('Sector Norte');
    expect(component.locationReference()).toBe('Frente al parque');
    expect(component.locationObservations()).toBe('Portón azul');
    expect(component.facadePhoto()).toBe(photo);
  });

  it('Guardar propiedad envía las coordenadas capturadas', () => {
    openLocationForm();
    component.locationAddress.set('Sector Norte');
    component.useCurrentLocation();
    geolocation.getCurrentPosition.mock.calls[0][0]({
      coords: { latitude: 14.6349142, longitude: -90.5068824 },
    } as GeolocationPosition);
    component.confirmMapCoordinates(component.propertyMapCoordinates()!);

    component.submitLocation(new Event('submit'));

    expect(visitasService.registerFirstLocation.mock.calls[0][1]).toEqual({
      direccion: 'Sector Norte',
      latitud: 14.6349142,
      longitud: -90.5068824,
    });
  });

  it('cancelar limpia coordenadas e ignora una respuesta tardía', () => {
    openLocationForm();
    component.useCurrentLocation();
    const success = geolocation.getCurrentPosition.mock.calls[0][0];

    component.closeLocationRegistration();
    success({
      coords: { latitude: 14.6349142, longitude: -90.5068824 },
    } as GeolocationPosition);

    expect(component.capturedLatitude()).toBeNull();
    expect(component.capturedLongitude()).toBeNull();
    expect(component.geolocationMessage()).toBe('');
    expect(component.visitForLocation()).toBeNull();
  });

  it('Seleccionar en mapa confirma coordenadas sin guardar la propiedad', () => {
    openLocationForm();
    component.selectLocationOnMap();

    expect(component.propertyMapMode()).toBe('select');
    expect(component.propertyMapCoordinates()).toBeNull();
    component.confirmMapCoordinates({ latitud: 14.61, longitud: -90.52 });

    expect(component.capturedLatitude()).toBe(14.61);
    expect(component.capturedLongitude()).toBe(-90.52);
    expect(component.geolocationMessage()).toBe('Ubicación seleccionada');
    expect(visitasService.registerFirstLocation).not.toHaveBeenCalled();
  });

  it('Cancelar el mapa conserva formulario y coordenadas confirmadas anteriores', () => {
    openLocationForm();
    component.locationAddress.set('Sector Norte');
    component.locationReference.set('Frente al parque');
    component.capturedLatitude.set(14.6);
    component.capturedLongitude.set(-90.5);

    component.selectLocationOnMap();
    component.closePropertyMap();

    expect(component.locationAddress()).toBe('Sector Norte');
    expect(component.locationReference()).toBe('Frente al parque');
    expect(component.capturedLatitude()).toBe(14.6);
    expect(component.capturedLongitude()).toBe(-90.5);
  });

  it('un error de Google Maps no rompe ni limpia el formulario', async () => {
    mapsLoader.load.mockRejectedValue(new Error('No fue posible cargar Google Maps.'));
    openLocationForm();
    component.locationAddress.set('Sector Norte');

    component.selectLocationOnMap();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.textContent).toContain('No fue posible cargar Google Maps.'),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No fue posible cargar Google Maps.');
    expect(component.locationAddress()).toBe('Sector Norte');
    expect(component.visitForLocation()).not.toBeNull();
  });

  it('visita con propiedad muestra datos de lectura y oculta Registrar ubicación', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          direccion_propiedad: 'Barrio Central',
          referencia_propiedad: 'Casa azul',
          foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_31.webp',
          ubicacion_disponible: true,
        },
      ]),
    );

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 2');
    expect(fixture.nativeElement.textContent).toContain('Barrio Central');
    expect(fixture.nativeElement.textContent).toContain('Casa azul');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.querySelector('.task-location img')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación geográfica pendiente');
    expect(fixture.nativeElement.textContent).not.toContain('Ver en mapa');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
  });

  it('visita con datos opcionales vacíos no muestra placeholders de dirección o referencia', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          direccion_propiedad: '   ',
          referencia_propiedad: null,
          ubicacion_disponible: true,
        },
      ]),
    );

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 2');
    expect(fixture.nativeElement.textContent).not.toContain('Dirección no registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Sin referencia');
  });

  it('propiedad con coordenadas ofrece Ver en mapa en modo solo lectura', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          direccion_propiedad: 'Barrio Central',
          referencia_propiedad: 'Casa azul',
          latitud: 14.6349142,
          longitud: -90.5068824,
          ubicacion_disponible: true,
        },
      ]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ver en mapa');
    expect(fixture.nativeElement.textContent).toContain('📍 Cómo llegar');
    component.openRegisteredLocationMap(component.tasks()[0]);

    expect(component.propertyMapMode()).toBe('readonly');
    expect(component.propertyMapCoordinates()).toEqual({
      latitud: 14.6349142,
      longitud: -90.5068824,
    });
    expect(component.visitForLocation()).toBeNull();
  });

  it('Cómo llegar de una visita prepara su propiedad sin abrir navegación externa', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          latitud: 14.6349142,
          longitud: -90.5068824,
          ubicacion_disponible: true,
        },
      ]),
    );
    fixture.detectChanges();

    component.prepareDirections(component.tasks()[0]);

    expect(component.mapNavigationTarget()).toEqual({
      id_ubicacion: 31,
      numeroPropiedad: 2,
      latitud: 14.6349142,
      longitud: -90.5068824,
    });
  });

  it('instalación usa su id_ubicacion, muestra Propiedad N y prepara Cómo llegar', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[0]]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 2');
    expect(fixture.nativeElement.textContent).toContain('📍 Cómo llegar');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Ver en mapa');

    const installation = component.tasks()[0];
    component.openLocationRegistration(installation);
    component.prepareDirections(installation);

    expect(component.visitForLocation()).toBeNull();
    expect(component.mapNavigationTarget()).toEqual({
      id_ubicacion: 44,
      numeroPropiedad: 2,
      latitud: 14.6349142,
      longitud: -90.5068824,
    });
  });

  it('instalación histórica sin propiedad se marca inconsistente y no inventa destino', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[0],
          id_ubicacion: null,
          numero_propiedad: null,
          direccion_propiedad: null,
          referencia_propiedad: null,
          foto_fachada: null,
          latitud: null,
          longitud: null,
          ubicacion_disponible: false,
        },
      ]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Inconsistencia de ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
    component.prepareDirections(component.tasks()[0]);
    expect(component.mapNavigationTarget()).toBeNull();
  });

  it('instalación con propiedad sin coordenadas no muestra avisos ni Cómo llegar', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[0],
          latitud: null,
          longitud: null,
        },
      ]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 2');
    expect(fixture.nativeElement.textContent).not.toContain('coordenadas geográficas');
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación geográfica pendiente');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
    expect(component.mapNavigationTarget()).toBeNull();
  });

  it('muestra errores HTTP sin cerrar el formulario', () => {
    visitasService.registerFirstLocation.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { detail: 'La visita ya tiene una propiedad registrada' },
          }),
      ),
    );
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));
    fixture.detectChanges();
    component.openLocationRegistration(component.tasks()[0]);
    component.locationAddress.set('Sector Norte');

    component.submitLocation(new Event('submit'));
    fixture.detectChanges();

    expect(component.locationFormError()).toBe('La visita ya tiene una propiedad registrada');
    expect(component.visitForLocation()).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'La visita ya tiene una propiedad registrada',
    );
  });

  it('muestra el error laboral específico cuando el usuario no tiene empleado asociado', () => {
    tareasService.getAll.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { detail: 'El usuario no tiene un empleado asociado' },
          }),
      ),
    );

    fixture.detectChanges();

    expect(component.loadError()).toBe('El usuario no tiene un empleado asociado');
    expect(fixture.nativeElement.textContent).toContain('El usuario no tiene un empleado asociado');
  });

  it('recupera la evaluación existente usando id_visita al continuar', () => {
    const visit = { ...task(15, new Date(), '09:30', 'Visita Técnica', 'En Proceso') };

    component.openVisitEvaluation(visit);

    expect(visitasService.getEvaluation).toHaveBeenCalledWith(15);
    expect(component.visitForEvaluation()?.id_visita).toBe(15);
    expect(component.visitForEvaluation()?.evaluacion?.descripcionTrabajo).toBe('Instalar enlace');
  });

  it('permite Ver una visita propia siempre en modo solo lectura', () => {
    const visit = task(15, new Date(), '09:30', 'Visita Técnica', 'Programada');

    component.openVisitDetails(visit);

    expect(visitasService.getById).toHaveBeenCalledWith(15);
    expect(component.visitForEvaluation()).toEqual(
      expect.objectContaining({ id_visita: 15, soloLectura: true }),
    );
  });

  it('muestra la visita de una compañera, permite Ver y bloquea sus acciones técnicas', () => {
    const companionVisit: Tarea = {
      ...apiTasks[1],
      id: 16,
      id_visita: 16,
      tecnicos: [{ id_empleado: 6, codigo: 'EMP-0006', nombre: 'MARIA PEREZ', es_encargado: true }],
      puede_realizar_acciones: false,
      es_responsable: false,
      bloqueada: true,
    };
    tareasService.getAll.mockReturnValue(of([companionVisit]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('MARIA PEREZ');
    expect(fixture.nativeElement.textContent).toContain('Acciones técnicas bloqueadas');
    expect(fixture.nativeElement.textContent).not.toContain('Realizar evaluación');

    component.openVisitDetails(component.tasks()[0]);
    expect(visitasService.getById).toHaveBeenCalledWith(16);
    expect(component.visitForEvaluation()?.soloLectura).toBe(true);
  });

  it('ordena los grupos por fecha y las tareas de cada día por hora', () => {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    component.tasks.set([
      task(3, tomorrow, '14:00'),
      task(2, today, '10:30'),
      task(1, today, '08:00'),
    ]);

    const groups = component.taskGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0].etiqueta).toContain('HOY');
    expect(groups[0].tareas.map((item) => item.hora)).toEqual(['08:00', '10:30']);
    expect(groups[1].etiqueta).toContain('MAÑANA');
    expect(groups[1].tareas.map((item) => item.hora)).toEqual(['14:00']);
  });

  it('prioriza hoy, futuros ascendentes y pasados desde el más reciente', () => {
    const today = new Date();
    const tomorrow = shiftedDate(today, 1);
    const later = shiftedDate(today, 3);
    const yesterday = shiftedDate(today, -1);
    const older = shiftedDate(today, -4);
    component.tasks.set([
      task(5, older, '07:00'),
      task(3, later, '12:00'),
      task(2, today, '16:00'),
      task(4, yesterday, '10:00'),
      task(1, today, '08:00'),
      task(6, tomorrow, '09:00'),
    ]);

    const groups = component.taskGroups();
    expect(groups.map((group) => group.fecha)).toEqual([
      dateKey(today),
      dateKey(tomorrow),
      dateKey(later),
      dateKey(yesterday),
      dateKey(older),
    ]);
    expect(groups[0].etiqueta).toMatch(/^HOY, /);
    expect(groups[0].tareas.map((item) => item.hora)).toEqual(['08:00', '16:00']);
  });

  it('mantiene el orden temporal con búsqueda y filtros sin alterar contadores', () => {
    const today = new Date();
    component.tasks.set([
      task(1, shiftedDate(today, -1), '08:00', 'Visita Técnica', 'Programada'),
      task(2, shiftedDate(today, 1), '09:00', 'Instalación', 'Programada'),
      task(3, today, '10:00', 'Visita Técnica', 'Programada'),
      task(4, shiftedDate(today, 2), '11:00', 'Visita Técnica', 'Completada'),
    ]);
    component.searchTerm.set('cliente');

    expect(component.filteredTasks().map((item) => item.id)).toEqual([3, 2, 4, 1]);
    component.typeFilter.set('Visita Técnica');
    expect(component.filteredTasks().map((item) => item.id)).toEqual([3, 4, 1]);
    component.statusFilter.set('Programada');
    expect(component.filteredTasks().map((item) => item.id)).toEqual([3, 1]);
    expect(component.statusCounts()).toEqual({ Programada: 3, 'En Proceso': 0, Completada: 1 });
  });

  it('conserva tareas históricas entregadas por el backend', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    component.tasks.set([task(7, yesterday, '08:00')]);

    expect(component.upcomingTasks().map((item) => item.id)).toEqual([7]);
  });

  it('calcula contadores y aplica filtros sin alterar el resumen', () => {
    const today = new Date();
    component.tasks.set([
      task(1, today, '08:00', 'Instalación', 'Programada'),
      task(2, today, '09:00', 'Visita Técnica', 'Completada'),
    ]);
    component.typeFilter.set('Instalación');

    expect(component.filteredTasks().map((item) => item.id)).toEqual([1]);
    expect(component.statusCounts()).toEqual({ Programada: 1, 'En Proceso': 0, Completada: 1 });
  });

  it('no simula localmente el inicio de una instalación', () => {
    const installation = task(1, new Date(), '08:00', 'Instalación', 'Programada');
    component.tasks.set([installation]);

    component.openStartInstallation(installation);
    expect(component.installationToStart()?.id).toBe(1);
    component.confirmStartInstallation();

    expect(component.tasks()[0].estado).toBe('Programada');
    expect(component.installationToStart()).toBeNull();
    expect(component.loadError()).toContain('no se modifica desde Tareas');
  });

  it('no abre el inicio para visitas, tareas bloqueadas o instalaciones no programadas', () => {
    const visit = task(1, new Date(), '08:00', 'Visita Técnica', 'Programada');
    const blocked = { ...task(2, new Date(), '09:00'), bloqueada: true };
    const completed = task(3, new Date(), '10:00', 'Instalación', 'Completada');

    component.openStartInstallation(visit);
    component.openStartInstallation(blocked);
    component.openStartInstallation(completed);

    expect(component.installationToStart()).toBeNull();
  });

  it('abre Completar instalación para una instalación En Proceso y Cancelar no cambia el estado', () => {
    const installation = task(4, new Date(), '11:00', 'Instalación', 'En Proceso');
    installation.cliente = 'Juan Francisco Martínez Ruiz';
    fixture.detectChanges();
    component.tasks.set([installation]);
    fixture.detectChanges();

    const completeButton = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.task-primary-action',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Completar instalación'));
    completeButton?.click();
    fixture.detectChanges();

    expect(component.installationToComplete()?.cliente).toBe('Juan Francisco Martínez Ruiz');
    expect(fixture.nativeElement.querySelector('app-completar-instalacion')).toBeTruthy();
    (fixture.nativeElement.querySelector('.completion-cancel') as HTMLButtonElement).click();
    expect(component.installationToComplete()).toBeNull();
    expect(component.tasks()[0].estado).toBe('En Proceso');
  });

  it('no permite completar nuevamente una instalación Completada', () => {
    const completed = task(5, new Date(), '12:00', 'Instalación', 'Completada');
    fixture.detectChanges();
    component.tasks.set([completed]);
    fixture.detectChanges();

    component.openCompleteInstallation(completed);

    expect(component.installationToComplete()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Completar instalación');
  });

  function task(
    id: number,
    date: Date,
    hour: string,
    type: TareaTecnicaRow['tipo'] = 'Instalación',
    status: TareaTecnicaRow['estado'] = 'Programada',
  ): TareaTecnicaRow {
    return {
      id,
      id_visita: type === 'Visita Técnica' ? id : null,
      id_instalacion: type === 'Instalación' ? id : null,
      id_ubicacion: null,
      tipo: type,
      fecha: dateKey(date),
      hora: hour,
      cliente: `Cliente ${id}`,
      tipoInstalacion: 'Internet',
      tecnico: `Técnico ${id}`,
      estado: status,
      puedeVer: true,
      puedeRealizarAcciones: type === 'Visita Técnica' && status !== 'Completada',
      esResponsable: type === 'Visita Técnica',
    };
  }

  function openLocationForm(): void {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));
    fixture.detectChanges();
    component.openLocationRegistration(component.tasks()[0]);
    fixture.detectChanges();
  }

  function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function shiftedDate(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }
});
