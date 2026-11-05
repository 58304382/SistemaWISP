import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { Tarea } from '../../models/tarea.models';
import { TareasService } from '../../services/tareas.service';
import { OrdenTrabajo } from '../../../ordenes-trabajo/models/orden-trabajo.models';
import { OrdenesTrabajoService } from '../../../ordenes-trabajo/services/ordenes-trabajo.service';
import { VisitasTecnicasService } from '../../../visitas-tecnicas/services/visitas-tecnicas.service';
import { CotizacionesService } from '../../../cotizaciones/services/cotizaciones.service';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { InstalacionesService } from '../../../instalaciones/services/instalaciones.service';
import { Instalacion } from '../../../instalaciones/models/instalacion.models';
import { TicketsService } from '../../../soporte-tecnico/services/tickets.service';
import { TicketDetalle } from '../../../soporte-tecnico/models/ticket.models';
import { TareaTecnicaRow, TareasComponent } from './tareas.component';

describe('TareasComponent', () => {
  let fixture: ComponentFixture<TareasComponent>;
  let component: TareasComponent;
  let tareasService: { getAll: ReturnType<typeof vi.fn> };
  let instalacionesService: { start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; getById: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let ordenesService: {
    start: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getEvaluacion: ReturnType<typeof vi.fn>;
    registrarEvaluacion: ReturnType<typeof vi.fn>;
    finalizar: ReturnType<typeof vi.fn>;
  };
  let visitasService: {
    getById: ReturnType<typeof vi.fn>;
    getEvaluation: ReturnType<typeof vi.fn>;
    startEvaluation: ReturnType<typeof vi.fn>;
    finishEvaluation: ReturnType<typeof vi.fn>;
  };
  let cotizacionesService: {
    registrarTrabajoAdicional: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
  let clientesService: { getById: ReturnType<typeof vi.fn> };
  let ticketsService: { getById: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };

  // El ID coincide con una instalación para comprobar que soporte nunca reemplaza otra fuente.
  const supportDetail: TicketDetalle = {
    id_ticket: 3, codigo: 'TKT-000003', id_cliente: 8, cliente: 'Cliente soporte', telefono_cliente: '55554444',
    id_categoria: 1, categoria: 'Servicio de Internet', id_tecnico: 9, tecnico: 'Ana Técnica', canal: 'Llamada',
    asunto: 'Enlace intermitente', descripcion: 'Revisar señal', observaciones: null,
    fecha_apertura: '2099-09-21T08:00:00', fecha_inicio: '2099-09-21T09:00:00', fecha_resolucion: '2099-09-21T10:00:00', estado: 'Completada',
    historial: [{ id_historial: 1, id_usuario: 2, usuario: 'Ana Técnica', estado_anterior: 'En Proceso', estado_nuevo: 'Completada', accion: 'Finalización de soporte',
      observacion: 'Validado por cliente', trabajo_realizado: 'Ajustar antena', resultado_solucion: 'Señal estable', evidencia_foto_ruta: 'uploads/soporte_tecnico/ticket_3_uuid.webp', fecha_hora: '2099-09-21T10:00:00' }],
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

  // Detalle persistido simulado: Ver no utiliza endpoints de mutación ni datos reales.
  const installationDetail: Instalacion = {
    id_instalacion: 3, id_cliente: 8, id_visita: 12, id_ubicacion: 44,
    fecha_programada: '2026-10-22', hora_programada: '09:30:00', estado: 'Programada',
    observaciones: 'Llamar antes de llegar', observaciones_tecnicas: null,
    fecha_finalizacion: null, evidencia_fotografica: null, fecha_registro: '2026-10-20T10:00:00',
    cliente: { id_cliente: 8, nombre: 'Juan Pérez', telefono: '55551234', direccion: 'Zona 1',
      municipio: 'Guatemala', dpi: '1234567890101', correo: 'cliente@example.com', referencia: 'Frente al parque', estado: 'Activo' },
    visita: { id_visita: 12, id_tipo_instalacion: 2, tipo_instalacion: 'Internet',
      fecha_programada: '2026-10-20', hora_programada: '08:00:00', estado: 'Completada',
      motivo_visita: 'Evaluar enlace', indicaciones: 'Portón azul', observaciones: 'Visita validada',
      nombre_tecnico: 'Ana Técnica', foto_referencia: null, id_evaluacion: 31,
      descripcion_evaluacion: 'Instalar enlace en terraza', tecnicos_recomendados: 2,
      condiciones_lugar: 'Terraza accesible', observacion_tecnica: 'Enlace viable',
      materiales: [{ id_detalle: 1, descripcion: 'Cable UTP', cantidad: 20, unidad: 'Metro' }] },
    ubicacion: { id_ubicacion: 44, direccion: 'Sector Norte', latitud: 14.63, longitud: -90.5,
      referencia: 'Frente al parque', observaciones: 'Acceso por terraza', numero_propiedad: 2,
      foto_fachada: '/uploads/ubicaciones_clientes/44.webp', estado: 'Activo' },
    tecnicos: [{ id_empleado: 9, codigo: 'EMP-0009', nombres: 'Ana', apellidos: 'Técnica', id_puesto: 1, nombre_puesto: 'Técnico', estado: 'Activo', es_encargado: true }],
    encargado: { id_empleado: 9, codigo: 'EMP-0009', nombres: 'Ana', apellidos: 'Técnica', id_puesto: 1, nombre_puesto: 'Técnico', estado: 'Activo', es_encargado: true },
  };

  beforeEach(async () => {
    ticketsService = { getById: vi.fn().mockReturnValue(of(supportDetail)), start: vi.fn().mockReturnValue(of({ ...supportDetail, estado: 'En Proceso' })), complete: vi.fn() };
    tareasService = { getAll: vi.fn().mockReturnValue(of([])) };
    instalacionesService = {
      start: vi.fn().mockReturnValue(of({ id_instalacion: 1, estado: 'En Proceso', visita: null })),
      complete: vi.fn().mockReturnValue(of({ id_instalacion: 1, estado: 'Completada', visita: null })),
      getById: vi.fn().mockReturnValue(of(installationDetail)),
    };
    router = { navigate: vi.fn().mockResolvedValue(true) };
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
      startEvaluation: vi.fn(),
      finishEvaluation: vi.fn(),
    };
    ordenesService = {
      start: vi.fn().mockReturnValue(of({} as OrdenTrabajo)),
      getById: vi.fn().mockReturnValue(of({} as OrdenTrabajo)),
      getEvaluacion: vi.fn().mockReturnValue(of(null)),
      registrarEvaluacion: vi.fn().mockReturnValue(of({} as OrdenTrabajo)),
      finalizar: vi.fn(),
    };
    cotizacionesService = {
      registrarTrabajoAdicional: vi.fn().mockReturnValue(
        of({
          id_cotizacion: 9,
          numero_cotizacion: 'COT-2026-0008',
          estado: 'EN PROCESO',
          detalles: [],
          subtotal: 0,
          impuesto: 0,
          total: 0,
        }),
      ),
      getById: vi.fn().mockReturnValue(of({})),
    };
    clientesService = {
      getById: vi.fn().mockReturnValue(of({ telefono: '55551234' })),
    };
    await TestBed.configureTestingModule({
      imports: [TareasComponent],
      providers: [
        { provide: TareasService, useValue: tareasService },
        { provide: InstalacionesService, useValue: instalacionesService },
        { provide: VisitasTecnicasService, useValue: visitasService },
        { provide: OrdenesTrabajoService, useValue: ordenesService },
        { provide: CotizacionesService, useValue: cotizacionesService },
        { provide: ClientesService, useValue: clientesService },
        { provide: TicketsService, useValue: ticketsService },
        { provide: Router, useValue: router },
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

  /** Mantiene filtros y estados de otras fuentes al ejecutar tickets con IDs coincidentes. */
  it('integra soporte en el mismo tablero y cambia sus acciones solo tras la respuesta del servidor', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[0], {
      ...apiTasks[0], tipo: 'Soporte Técnico', id_instalacion: null, id_ticket: 3, codigo_ticket: 'TKT-000003',
      puede_realizar_acciones: true, es_responsable: true, bloqueada: false,
    }]));
    fixture.detectChanges();
    component.typeFilter.set('Soporte Técnico'); fixture.detectChanges();
    expect(component.filteredTasks()).toHaveLength(1);
    let card = fixture.nativeElement.querySelector('.task-card') as HTMLElement;
    expect(card.textContent).toContain('Iniciar soporte');
    expect(card.textContent).not.toContain('Completar instalación');
    const response = new Subject<TicketDetalle>(); ticketsService.start.mockReturnValue(response);
    (card.querySelector('.task-primary-action') as HTMLButtonElement).click();
    component.startSupport(component.filteredTasks()[0]);
    expect(ticketsService.start).toHaveBeenCalledOnce();
    expect(component.filteredTasks()[0].estado).toBe('Programada');
    response.next({ ...supportDetail, estado: 'En Proceso' }); response.complete(); fixture.detectChanges();
    expect(component.tasks()[0].estado).toBe('Programada');
    expect(component.filteredTasks()[0].estado).toBe('En Proceso');
    card = fixture.nativeElement.querySelector('.task-card') as HTMLElement;
    expect(card.textContent).toContain('Finalizar soporte');
    (card.querySelector('.task-primary-action') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-finalizar-soporte')).not.toBeNull();
    component.onSupportCompleted(supportDetail); fixture.detectChanges();
    expect(component.filteredTasks()[0].estado).toBe('Completada');
    expect(component.tasks()[0].estado).toBe('Programada');
    card = fixture.nativeElement.querySelector('.task-card') as HTMLElement;
    expect(card.textContent).toContain('Ver');
    expect(card.querySelector('.task-primary-action')).toBeNull();
    expect(instalacionesService.start).not.toHaveBeenCalled(); expect(ordenesService.start).not.toHaveBeenCalled();
  });

  it('Ver de soporte muestra el mismo informe, historial y fotografía de Soporte Técnico', () => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[0], tipo: 'Soporte Técnico', id_ticket: 3, id_instalacion: null, estado: 'Completada' }]));
    fixture.detectChanges(); component.openTaskDetails(component.tasks()[0]); fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('[aria-labelledby="support-task-detail-title"]') as HTMLElement;
    for (const text of ['55554444', 'Ajustar antena', 'Señal estable', 'Validado por cliente', 'Finalización de soporte']) expect(modal.textContent).toContain(text);
    expect(modal.querySelector('img')?.getAttribute('src')).toBe('http://127.0.0.1:8000/uploads/soporte_tecnico/ticket_3_uuid.webp');
    expect(modal.querySelectorAll('input, textarea, form')).toHaveLength(0);
    expect(ticketsService.getById).toHaveBeenCalledWith(3);
  });

  it('no inicia ni finaliza soporte sin responsabilidad, capacidad o estado correcto', () => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[0], tipo: 'Soporte Técnico', id_ticket: 3, id_instalacion: null }]));
    fixture.detectChanges();
    const task = component.tasks()[0];
    component.startSupport(task);
    component.startSupport({ ...task, puedeRealizarAcciones: true, esResponsable: false });
    component.startSupport({ ...task, puedeRealizarAcciones: true, bloqueada: true });
    component.startSupport({ ...task, puedeRealizarAcciones: true, estado: 'Completada' });
    component.openCompleteSupport({ ...task, puedeRealizarAcciones: true });
    component.openCompleteSupport({ ...task, estado: 'En Proceso', puedeRealizarAcciones: true, esResponsable: false });
    expect(ticketsService.start).not.toHaveBeenCalled(); expect(component.supportToComplete()).toBeNull();
  });

  it('conserva Programada si FastAPI rechaza iniciar y descarta detalles tardíos al cerrar', () => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[0], tipo: 'Soporte Técnico', id_ticket: 3, puede_realizar_acciones: true }]));
    ticketsService.start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { detail: 'Otro técnico' } })));
    fixture.detectChanges(); component.startSupport(component.tasks()[0]);
    expect(component.tasks()[0].estado).toBe('Programada'); expect(component.loadError()).not.toBe('');
    const response = new Subject<TicketDetalle>(); ticketsService.getById.mockReturnValue(response);
    component.openTaskDetails(component.tasks()[0]); component.closeSupportDetails(); response.next(supportDetail); response.complete();
    expect(component.viewedSupport()).toBeNull(); expect(component.supportDetailId()).toBeNull();
  });

  it('visita Programada sin propiedad exige iniciar antes de registrar ubicación', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[1]]));

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación no registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
  });

  it('Registrar ubicación navega al formulario contextual de Mapas durante En Proceso', () => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[1], estado: 'En Proceso' }]));
    fixture.detectChanges();

    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((item) => item.textContent?.trim() === 'Registrar ubicación');
    button?.click();

    expect(button).toBeTruthy();
    expect(router.navigate).toHaveBeenCalledWith(['/tareas', 'visitas', 15, 'mapa']);
  });

  it('visita con ubicación muestra únicamente Ver en mapa', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          direccion_propiedad: 'Barrio Central',
          referencia_propiedad: 'Casa azul',
          foto_fachada: '/uploads/ubicaciones_clientes/ubicacion_31.webp',
          latitud: 14.6349142,
          longitud: -90.5068824,
          ubicacion_disponible: true,
        },
      ]),
    );

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ver en mapa');
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación registrada');
    expect(fixture.nativeElement.textContent).not.toContain('Barrio Central');
    expect(fixture.nativeElement.textContent).not.toContain('Casa azul');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.querySelector('.task-location img')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación geográfica pendiente');
    expect(fixture.nativeElement.textContent).not.toContain('Ir a mapa');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
  });

  it('visita con propiedad sin coordenadas conserva Registrar ubicación durante En Proceso', () => {
    tareasService.getAll.mockReturnValue(
      of([
        {
          ...apiTasks[1],
          id_ubicacion: 31,
          numero_propiedad: 2,
          direccion_propiedad: '   ',
          referencia_propiedad: null,
          estado: 'En Proceso',
          ubicacion_disponible: true,
        },
      ]),
    );

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación no registrada');
    expect(fixture.nativeElement.textContent).toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Ubicación registrada');
  });

  it('propiedad registrada ofrece únicamente Ver en mapa y navega por id de visita', () => {
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
    expect(fixture.nativeElement.textContent).not.toContain('Ir a mapa');
    expect(fixture.nativeElement.textContent).not.toContain('Cómo llegar');
    expect(fixture.nativeElement.textContent).not.toContain('Corregir ubicación');

    component.goToVisitMap(component.tasks()[0]);

    expect(router.navigate).toHaveBeenCalledWith(['/tareas', 'visitas', 15, 'mapa']);
  });

  it('instalación usa su id_ubicacion y abre su mapa contextual desde Cómo llegar', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[0]]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ubicación registrada · Propiedad 2');
    expect(fixture.nativeElement.textContent).toContain('📍 Cómo llegar');
    expect(fixture.nativeElement.textContent).not.toContain('Registrar ubicación');
    expect(fixture.nativeElement.textContent).not.toContain('Ver en mapa');

    const installation = component.tasks()[0];
    (fixture.nativeElement.querySelector('[data-action="directions"]') as HTMLButtonElement).click();

    expect(router.navigate).toHaveBeenCalledWith(['/tareas', 'instalaciones', installation.id_instalacion, 'mapa']);
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
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { puede_ver: false },
    { latitud: Number.NaN },
    { longitud: Number.POSITIVE_INFINITY },
    { latitud: 91 },
    { longitud: -181 },
    { latitud: null },
  ])('no navega a instalaciones sin lectura o destino válido: %j', (invalid) => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[0], ...invalid }]));
    fixture.detectChanges();
    component.prepareDirections(component.tasks()[0]);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.mapNavigationTarget()).toBeNull();
  });

  it('Ver de instalación abre detalle completo de solo lectura sin iniciar ni finalizar', () => {
    tareasService.getAll.mockReturnValue(of([{
      ...apiTasks[0], estado: 'Completada', puede_realizar_acciones: false, puede_ver: true,
    }]));
    instalacionesService.getById.mockReturnValue(of({ ...installationDetail, estado: 'Completada' }));
    fixture.detectChanges();
    const tareasAntes = component.tasks();
    const boton = fixture.nativeElement.querySelector('.task-actions-secondary button') as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    boton.click();
    fixture.detectChanges();

    expect(instalacionesService.getById).toHaveBeenCalledOnce();
    expect(instalacionesService.getById).toHaveBeenCalledWith(3);
    const modal = fixture.nativeElement.querySelector('[aria-labelledby="installation-task-detail-title"]') as HTMLElement;
    for (const texto of ['Juan Pérez', 'cliente@example.com', 'Evaluar enlace', 'Instalar enlace en terraza', 'Terraza accesible', 'Enlace viable', 'Cable UTP', 'Sector Norte', 'Ana Técnica', 'Encargado', 'Completada']) {
      expect(modal.textContent).toContain(texto);
    }
    expect(modal.querySelector('img[alt="Fachada de la propiedad de la instalación"]')?.getAttribute('src')).toBe('http://127.0.0.1:8000/uploads/ubicaciones_clientes/44.webp');
    const mapa = modal.querySelector('a.installation-detail-map') as HTMLAnchorElement;
    expect(mapa.href).toBe('https://www.google.com/maps/dir/?api=1&destination=14.63%2C-90.5&travelmode=driving');
    expect(mapa.rel).toContain('noopener');
    expect(modal.querySelectorAll('input, select, textarea, form')).toHaveLength(0);
    expect(modal.textContent).not.toContain('Confirmar inicio');
    expect(modal.textContent).not.toContain('Completar instalación');
    expect(clientesService.getById).not.toHaveBeenCalled();
    expect(visitasService.getById).not.toHaveBeenCalled();
    expect(instalacionesService.start).not.toHaveBeenCalled();
    expect(instalacionesService.complete).not.toHaveBeenCalled();
    (modal.querySelector('footer button') as HTMLButtonElement).click();
    expect(component.installationDetailId()).toBeNull();
    expect(component.tasks()).toBe(tareasAntes);
  });

  it('Ver respeta permisos y no consulta la API cuando la tarjeta no autoriza lectura', () => {
    tareasService.getAll.mockReturnValue(of([{ ...apiTasks[0], puede_ver: false }]));
    fixture.detectChanges();
    const boton = fixture.nativeElement.querySelector('.task-actions-secondary button') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    boton.click();
    component.openTaskDetails(component.tasks()[0]);
    expect(instalacionesService.getById).not.toHaveBeenCalled();
    expect(component.installationDetailId()).toBeNull();
  });

  it('muestra el rechazo de FastAPI sin exponer un detalle anterior ni mutar tareas', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[0]]));
    fixture.detectChanges();
    component.openTaskDetails(component.tasks()[0]);
    instalacionesService.getById.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { detail: 'La instalación está asignada a otro equipo técnico' } })));
    component.openTaskDetails(component.tasks()[0]);
    fixture.detectChanges();
    expect(component.viewedInstallation()).toBeNull();
    expect(component.installationMapUrl()).toBeNull();
    const modal = fixture.nativeElement.querySelector('[aria-labelledby="installation-task-detail-title"]') as HTMLElement;
    expect(modal.textContent).toContain('No tienes permisos');
    expect(modal.textContent).not.toContain('cliente@example.com');
    expect(instalacionesService.start).not.toHaveBeenCalled();
    expect(instalacionesService.complete).not.toHaveBeenCalled();
  });

  it('presenta instalaciones históricas sin visita ni ubicación sin inventar mapa o imágenes', () => {
    tareasService.getAll.mockReturnValue(of([apiTasks[0]]));
    instalacionesService.getById.mockReturnValue(of({ ...installationDetail, visita: null, ubicacion: null }));
    fixture.detectChanges();
    component.openTaskDetails(component.tasks()[0]);
    fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('[aria-labelledby="installation-task-detail-title"]') as HTMLElement;
    expect(modal.textContent).toContain('Sin visita técnica vinculada');
    expect(modal.textContent).toContain('Sin ubicación vinculada');
    expect(modal.querySelectorAll('img, a.installation-detail-map')).toHaveLength(0);
    expect(modal.textContent).not.toContain('undefined');
  });

  it('cerrar el detalle descarta respuestas tardías y no modifica inicio o cierre', () => {
    const respuesta = new Subject<Instalacion>();
    instalacionesService.getById.mockReturnValue(respuesta);
    tareasService.getAll.mockReturnValue(of([apiTasks[0]]));
    fixture.detectChanges();
    component.openTaskDetails(component.tasks()[0]);
    expect(component.loadingInstallationDetail()).toBe(true);
    component.closeInstallationDetails();
    respuesta.next(installationDetail);
    respuesta.complete();
    expect(component.viewedInstallation()).toBeNull();
    expect(component.installationDetailId()).toBeNull();
    expect(component.installationToStart()).toBeNull();
    expect(component.installationToComplete()).toBeNull();
  });

  it('el enlace al mapa solo utiliza coordenadas válidas de la ubicación consultada', () => {
    component.viewedInstallation.set({ ...installationDetail, ubicacion: { ...installationDetail.ubicacion!, latitud: 999 } });
    expect(component.installationMapUrl()).toBeNull();
    component.viewedInstallation.set({ ...installationDetail, ubicacion: { ...installationDetail.ubicacion!, latitud: 0, longitud: 0 } });
    expect(component.installationMapUrl()).toContain('destination=0%2C0');
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

  it('espera el inicio persistido y evita envíos repetidos de la instalación', () => {
    const respuesta = new Subject<Instalacion>();
    instalacionesService.start.mockReturnValue(respuesta);
    const installation = task(1, new Date(), '08:00', 'Instalación', 'Programada');
    component.tasks.set([installation]);

    component.openStartInstallation(installation);
    expect(component.installationToStart()?.id).toBe(1);
    component.confirmStartInstallation();

    expect(component.tasks()[0].estado).toBe('Programada');
    component.confirmStartInstallation();
    expect(instalacionesService.start).toHaveBeenCalledOnce();
    respuesta.next({ id_instalacion: 1, estado: 'En Proceso', visita: null } as Instalacion);
    respuesta.complete();
    expect(component.tasks()[0].estado).toBe('En Proceso');
    expect(component.installationToStart()).toBeNull();
    expect(component.loadError()).toBe('');
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

  it('muestra evaluación y accesorios y completa desde el formulario existente', () => {
    tareasService.getAll.mockReturnValue(of([{
      ...apiTasks[0], id: 1, id_instalacion: 1, estado: 'En Proceso',
      puede_realizar_acciones: true, bloqueada: false,
      descripcion: 'Instalar enlace en terraza',
      materiales: [{ id_detalle: 1, descripcion: 'Cable UTP', cantidad: 20, unidad: 'Metro' }],
    }]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Instalar enlace en terraza');
    expect(fixture.nativeElement.textContent).toContain('Cable UTP');
    component.openCompleteInstallation(component.tasks()[0]);
    fixture.detectChanges();
    const observacion = fixture.nativeElement.querySelector('#completion-observation') as HTMLTextAreaElement;
    observacion.value = 'Enlace validado';
    observacion.dispatchEvent(new Event('input'));
    const archivo = new File(['imagen simulada'], 'evidencia.png', { type: 'image/png' });
    const selector = fixture.nativeElement.querySelector('#gallery-evidence') as HTMLInputElement;
    Object.defineProperty(selector, 'files', { value: { item: () => archivo, length: 1, 0: archivo } });
    selector.dispatchEvent(new Event('change'));
    (fixture.nativeElement.querySelector('.completion-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(instalacionesService.complete).toHaveBeenCalledWith(1, 'Enlace validado', archivo);
    expect(component.tasks()[0].estado).toBe('Completada');
    expect(component.installationToComplete()).toBeNull();
    expect(component.statusCounts().Completada).toBe(1);
    expect(component.tasks()[0].puedeRealizarAcciones).toBe(false);
  });

  it('stops en Siguiente cuando la cantidad del material supera 2 decimales', () => {
    component.evaluationDiagnostico.set('Fuente dañada');
    component.evaluationTrabajoPropuesto.set('Reemplazo');
    component.orderEvalMateriales.set([
      { descripcion: 'Fuente', cantidad: '0.125', unidad: 'unidad' },
    ]);

    component.goToEvaluationSummary();

    expect(component.orderEvalStep()).toBe(1);
    expect(component.evaluationError()).toContain('máximo 2 decimales');
  });

  it('stops en Siguiente con mensaje de cantidad cuando es cero', () => {
    component.evaluationDiagnostico.set('D');
    component.evaluationTrabajoPropuesto.set('T');
    component.orderEvalMateriales.set([
      { descripcion: 'Fuente', cantidad: '0', unidad: 'unidad' },
    ]);

    component.goToEvaluationSummary();

    expect(component.orderEvalStep()).toBe(1);
    expect(component.evaluationError()).toContain('mayor a 0');
  });

  it('valida la longitud de la unidad por encima de 30 caracteres', () => {
    component.evaluationDiagnostico.set('D');
    component.evaluationTrabajoPropuesto.set('T');
    component.orderEvalMateriales.set([
      { descripcion: 'Fuente', cantidad: '1', unidad: 'unidad'.repeat(10) },
    ]);

    component.goToEvaluationSummary();

    expect(component.orderEvalStep()).toBe(1);
    expect(component.evaluationError()).toContain('30 caracteres');
  });

  it('avanza al resumen con materiales válidos y envía todos los materiales', () => {
    component.evaluationDiagnostico.set('Fuente dañada');
    component.evaluationTrabajoPropuesto.set('Reemplazo');
    component.evaluationOrderId.set(5);
    component.orderEvalMateriales.set([
      { descripcion: 'Fuente de poder', cantidad: '1.50', unidad: 'unidad' },
      { descripcion: 'Cable RJ45', cantidad: '2', unidad: 'm' },
    ]);

    component.goToEvaluationSummary();
    expect(component.orderEvalStep()).toBe(2);

    component.saveOrderEvaluation();

    expect(component.evaluationError()).toBe('');
    expect(ordenesService.registrarEvaluacion).toHaveBeenCalledWith(5, {
      diagnostico: 'Fuente dañada',
      trabajo_propuesto: 'Reemplazo',
      observaciones: null,
      materiales: [
        { descripcion: 'Fuente de poder', cantidad: 1.5, unidad: 'unidad' },
        { descripcion: 'Cable RJ45', cantidad: 2, unidad: 'm' },
      ],
    });
  });

  it('no envía materiales inválidos y muestra el error específico en Guardar', () => {
    component.evaluationDiagnostico.set('D');
    component.evaluationTrabajoPropuesto.set('T');
    component.evaluationOrderId.set(5);
    component.orderEvalStep.set(2);
    component.orderEvalMateriales.set([
      { descripcion: 'Fuente', cantidad: '0.123', unidad: 'unidad' },
    ]);

    component.saveOrderEvaluation();

    expect(component.evaluationError()).toContain('Material 1');
    expect(ordenesService.registrarEvaluacion).not.toHaveBeenCalled();
  });

  it('muestra «Trabajo rechazado» y no ofrece continuar cuando la cotización fue rechazada', () => {
    const rechazada: TareaTecnicaRow = {
      ...task(8, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true,
      esResponsable: true,
      tieneEvaluacion: true,
      reparacionAutorizada: false,
      trabajoRechazado: true,
    };
    fixture.detectChanges();
    component.tasks.set([rechazada]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Trabajo rechazado');
    expect(fixture.nativeElement.textContent).not.toContain('Continuar trabajo');
    expect(fixture.nativeElement.textContent).not.toContain('Trabajo terminado');
  });

  it('ordena las etapas de la orden según el avance comercial', () => {
    const base: TareaTecnicaRow = {
      ...task(9, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      tieneEvaluacion: true,
      reparacionAutorizada: false,
      trabajoRechazado: false,
    };

    expect(component.etapaOrden({ ...base, tieneEvaluacion: false })).toBe('registrar');
    expect(component.etapaOrden(base)).toBe('esperando');
    expect(component.etapaOrden({ ...base, trabajoRechazado: true })).toBe('rechazado');
    expect(component.etapaOrden({ ...base, reparacionAutorizada: true })).toBe('continuar');
    expect(
      component.etapaOrden({ ...base, reparacionAutorizada: true, tieneFinalizacion: true }),
    ).toBe('finalizado');
  });

  it('habilita «Actualizar cotización» solo para órdenes autorizadas sin revisión pendiente', () => {
    const orden: TareaTecnicaRow = {
      ...task(12, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true,
      esResponsable: true,
      tieneEvaluacion: true,
      reparacionAutorizada: true,
      trabajoRechazado: false,
      idCotizacion: 9,
    };

    expect(component.puedeActualizarCotizacion(orden)).toBe(true);
    // Sin cotización asociada no hay nada que reabrir.
    expect(component.puedeActualizarCotizacion({ ...orden, idCotizacion: null })).toBe(false);
    // Una revisión pendiente bloquea un nuevo envío.
    expect(
      component.puedeActualizarCotizacion({ ...orden, trabajoAdicionalEnRevision: true }),
    ).toBe(false);
    // Una orden ya finalizada no admite trabajo adicional.
    expect(
      component.puedeActualizarCotizacion({
        ...orden,
        estado: 'Completada',
        puedeRealizarAcciones: false,
      }),
    ).toBe(false);
  });

  it('muestra «Actualizar cotización» durante la ejecución y abre el formulario', () => {
    const orden: TareaTecnicaRow = {
      ...task(13, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true,
      esResponsable: true,
      tieneEvaluacion: true,
      reparacionAutorizada: true,
      reparacionEnEjecucion: true,
      idCotizacion: 9,
    };
    fixture.detectChanges();
    component.tasks.set([orden]);
    fixture.detectChanges();

    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((item) => item.textContent?.trim() === 'Actualizar cotización');
    expect(button).toBeTruthy();

    button?.click();
    fixture.detectChanges();

    expect(component.trabajoAdicionalOpen()).toBe(9);
    expect(component.trabajoAdicionalOrdenId()).toBe(13);
  });

  it('envía el trabajo adicional sin precios y lo deja en revisión comercial', () => {
    const orden: TareaTecnicaRow = {
      ...task(14, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true,
      esResponsable: true,
      tieneEvaluacion: true,
      reparacionAutorizada: true,
      idCotizacion: 9,
    };
    fixture.detectChanges();
    component.tasks.set([orden]);
    fixture.detectChanges();

    component.openTrabajoAdicional(orden);
    component.trabajoAdicionalMateriales.set([
      { descripcion: 'Conector RJ45', cantidad: '4', unidad: 'unidad' },
    ]);

    component.saveTrabajoAdicional();

    expect(cotizacionesService.registrarTrabajoAdicional).toHaveBeenCalledWith(9, {
      detalles: [
        { descripcion: 'Conector RJ45', cantidad: 4, unidad: 'unidad' },
      ],
    });
    expect(component.trabajoAdicionalOpen()).toBeNull();
    expect(component.estaTrabajoAdicionalEnRevision(orden)).toBe(true);
  });

  it('valida materiales reales sin exigir descripción general del trabajo adicional', () => {
    const orden: TareaTecnicaRow = {
      ...task(15, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true,
      esResponsable: true,
      tieneEvaluacion: true,
      reparacionAutorizada: true,
      idCotizacion: 9,
    };
    fixture.detectChanges();
    component.tasks.set([orden]);
    fixture.detectChanges();

    component.openTrabajoAdicional(orden);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Descripción del trabajo adicional');
    expect(fixture.nativeElement.textContent).toContain('Materiales / Repuestos adicionales');
    expect(fixture.nativeElement.textContent).toContain('Agregar material');
    expect(fixture.nativeElement.textContent).toContain('Enviar a revisión');
    component.saveTrabajoAdicional();

    expect(component.trabajoAdicionalError()).toContain('material o repuesto');
    expect(cotizacionesService.registrarTrabajoAdicional).not.toHaveBeenCalled();
    component.trabajoAdicionalMateriales.set([{ descripcion: 'Fuente', cantidad: '0', unidad: '' }]);
    component.saveTrabajoAdicional();
    expect(component.trabajoAdicionalError()).toContain('mayor a 0');
  });

  it('«Ver» de una orden carga el detalle, teléfono del cliente y cotización', () => {
    const orden: OrdenTrabajo = {
      id_orden: 20,
      codigo: 'OT-2026-0020',
      id_cliente: 5,
      nombre_cliente: 'LUIS COROXON',
      id_tipo_trabajo: 1,
      nombre_tipo_trabajo: 'Reparación',
      id_empleado: 4,
      nombre_tecnico: 'PABLO MERIDA',
      titulo: 'Reparar equipo',
      descripcion: 'No enciende',
      fecha_recepcion: '2026-10-01T10:00:00',
      fecha_estimada: null,
      estado: 'En Proceso',
      fecha_inicio: '2026-10-02T08:00:00',
      equipo: [],
      evaluacion: null,
      finalizacion: null,
      puede_editar: false,
      puede_eliminar: false,
      reparacion_autorizada: true,
      trabajo_rechazado: false,
      aprobacion_comercial_pendiente: false,
    };
    ordenesService.getById.mockReturnValue(of(orden));
    cotizacionesService.getById.mockReturnValue(
      of({
        id_cotizacion: 9,
        numero_cotizacion: 'COT-2026-0008',
        fecha: '2026-10-01',
        fecha_actualizacion: '2026-10-01',
        origen: 'ORDEN_TRABAJO',
        id_evaluacion: null,
        id_evaluacion_orden: 34,
        tipo_trabajo: 'Reparación',
        estado: 'ACEPTADA',
        porcentaje_descuento: '0',
        observaciones: null,
        cliente: {
          id_cliente: 5,
          nombres: 'LUIS',
          apellidos: 'COROXON',
          telefono: '55551234',
          direccion: 'Zona 1',
          departamento: 'Guatemala',
          municipio: 'Guatemala',
        },
        detalles: [],
        subtotal: '100',
        monto_descuento: '0',
        total: '100',
        tiene_proforma: true,
        proforma: { id_proforma: 3, fecha_generacion: '2026-10-02' },
      }),
    );

    const ordenTask: TareaTecnicaRow = {
      ...task(20, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeVer: true,
      idCotizacion: 9,
    };
    fixture.detectChanges();
    component.tasks.set([ordenTask]);
    fixture.detectChanges();

    component.openTaskDetails(ordenTask);

    expect(ordenesService.getById).toHaveBeenCalledWith(20);
    expect(component.viewedOrder()).toEqual(orden);
    expect(clientesService.getById).toHaveBeenCalledWith(5);
    expect(component.viewedOrderClientPhone()).toBe('55551234');
    expect(cotizacionesService.getById).toHaveBeenCalledWith(9);
    expect(component.viewedOrderCotizacion()?.numero_cotizacion).toBe('COT-2026-0008');

    // El modal horizontal debe renderizar su rejilla de datos y columnas de detalle.
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.task-detail-modal')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.task-detail-columns')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.task-detail-grid')).toBeTruthy();
  });

  it('avanceOrden describe el progreso real de la reparación', () => {
    const base: OrdenTrabajo = {
      id_orden: 21,
      codigo: 'OT-2026-0021',
      id_cliente: 5,
      nombre_cliente: 'Cliente',
      id_tipo_trabajo: 1,
      nombre_tipo_trabajo: 'Reparación',
      id_empleado: 4,
      nombre_tecnico: 'Técnico',
      titulo: 'Título',
      descripcion: 'Descripción',
      fecha_recepcion: '2026-10-01T10:00:00',
      fecha_estimada: null,
      estado: 'En Proceso',
      fecha_inicio: null,
      equipo: [],
      evaluacion: {
        id_evaluacion: 34,
        id_orden: 21,
        fecha_evaluacion: '2026-10-02T09:00:00',
        diagnostico: 'D',
        trabajo_propuesto: 'T',
        observaciones: null,
        materiales: [],
      },
      finalizacion: null,
      puede_editar: false,
      puede_eliminar: false,
      reparacion_autorizada: true,
      trabajo_rechazado: false,
      aprobacion_comercial_pendiente: false,
    };

    expect(component.avanceOrden({ ...base, evaluacion: null })).toContain(
      'Pendiente de evaluación',
    );
    expect(component.avanceOrden({ ...base, reparacion_autorizada: false })).toContain(
      'pendiente de autorización',
    );
    expect(component.avanceOrden({ ...base, trabajo_rechazado: true })).toContain('rechazada');
    expect(component.avanceOrden(base)).toContain('en ejecución');
    expect(component.avanceOrden({ ...base, estado: 'Completada' })).toBe(
      'Orden completada · trabajo finalizado',
    );
  });

  it('finaliza una orden autorizada por registro pendiente Q0.00 y refleja Completada', () => {
    // La autorización viene del DTO: cotización COMPLETADA en Cobros, sin exigir dinero recibido.
    const tarea: TareaTecnicaRow = {
      ...task(21, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true, esResponsable: true, reparacionAutorizada: true,
      tieneEvaluacion: true, reparacionEnEjecucion: false, idCotizacion: 9,
      tieneFinalizacion: true, puedeFinalizarOrden: true,
    };
    const completada: OrdenTrabajo = {
      id_orden: 21, codigo: 'OT-2026-0021', id_cliente: 5, nombre_cliente: 'Cliente',
      id_tipo_trabajo: 1, nombre_tipo_trabajo: 'Reparación', id_empleado: 4,
      nombre_tecnico: 'Técnico', titulo: 'Reparar equipo', descripcion: 'Revisión',
      fecha_recepcion: '2026-10-01T10:00:00', fecha_estimada: null, estado: 'Completada',
      fecha_inicio: '2026-10-02T08:00:00', equipo: [],
      evaluacion: { id_evaluacion: 34, id_orden: 21, fecha_evaluacion: '2026-10-02T09:00:00', diagnostico: 'D', trabajo_propuesto: 'T', observaciones: null, materiales: [] },
      finalizacion: { id_finalizacion: 3, id_orden: 21, trabajo_realizado: 'Cambio de fuente', resultado_solucion: 'Servicio restablecido', observaciones_finales: null, fecha_hora: '2026-10-20T12:00:00', evidencia_ruta: null },
      puede_editar: false, puede_eliminar: false, reparacion_autorizada: true,
      trabajo_rechazado: false, aprobacion_comercial_pendiente: false,
    };
    const respuesta = new Subject<OrdenTrabajo>();
    ordenesService.finalizar.mockReturnValue(respuesta);
    fixture.detectChanges();
    component.tasks.set([tarea]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Finalizar orden');
    expect(fixture.nativeElement.textContent).not.toContain('Trabajo terminado registrado');
    component.openOrderFinalizacion(tarea);
    component.finalizacionTrabajo.set('Cambio de fuente');
    component.finalizacionResultado.set('Servicio restablecido');
    component.saveOrderFinalizacion();
    expect(ordenesService.finalizar).not.toHaveBeenCalled();
    expect(component.finalizacionError()).toContain('Confirme la entrega');
    component.entregaConfirmada.set(true);
    component.saveOrderFinalizacion();
    component.saveOrderFinalizacion();
    component.closeOrderFinalizacion();
    expect(component.orderFinalizacionOpen()).toBe(21);
    expect(ordenesService.finalizar).toHaveBeenCalledOnce();
    respuesta.next(completada);
    respuesta.complete();
    fixture.detectChanges();

    expect(ordenesService.finalizar).toHaveBeenCalledWith(21, {
      trabajo_realizado: 'Cambio de fuente', resultado_solucion: 'Servicio restablecido',
      observaciones_finales: null,
    });
    expect(component.tasks()[0].estado).toBe('Completada');
    expect(component.tasks()[0].puedeRealizarAcciones).toBe(false);
    expect(component.tasks()[0].puedeFinalizarOrden).toBe(false);
    expect(component.statusCounts().Completada).toBe(1);
    expect(component.orderFinalizacionOpen()).toBeNull();
    expect(component.actionMessage()).toContain('Estado: Completada');
    expect(component.actionMessage()).toContain('Entrega confirmada');
    expect(component.actionMessage()).not.toContain('continúa En Proceso');
    expect(component.avanceOrden(completada)).not.toContain('pendiente');
    expect(fixture.nativeElement.querySelector('.task-primary-action')).toBeNull();
  });

  it('recupera de FastAPI la entrega habilitada sin depender de Continuar trabajo', () => {
    tareasService.getAll.mockReturnValue(of([{
      ...apiTasks[1], id: 21, tipo: 'Orden de Trabajo', id_visita: null, estado: 'En Proceso',
      tiene_evaluacion: true, tiene_finalizacion: true, reparacion_autorizada: true,
      puede_finalizar_orden: true,
    }]));
    fixture.detectChanges();
    expect(component.tasks()[0].puedeFinalizarOrden).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Finalizar orden');
    expect(fixture.nativeElement.textContent).not.toContain('Continuar trabajo');
    const boton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((item) => item.textContent?.trim() === 'Finalizar orden')!;
    boton.click();
    fixture.detectChanges();
    expect(component.orderFinalizacionOpen()).toBe(21);
    expect(fixture.nativeElement.textContent).toContain('Confirmo la entrega del teléfono o computadora');
  });

  it('no ofrece finalizar sin cotización COMPLETADA ni permite la entrega de otro técnico', () => {
    fixture.detectChanges();
    const tarea: TareaTecnicaRow = {
      ...task(21, new Date(), '10:00', 'Orden de Trabajo', 'En Proceso'),
      puedeRealizarAcciones: true, esResponsable: true, reparacionAutorizada: true,
      tieneEvaluacion: true, reparacionEnEjecucion: true, puedeFinalizarOrden: false,
    };
    component.tasks.set([tarea]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Finalizar orden');
    component.openOrderFinalizacion(tarea);
    expect(component.orderFinalizacionOpen()).toBeNull();
    component.openOrderFinalizacion({ ...tarea, puedeFinalizarOrden: true, esResponsable: false });
    expect(component.orderFinalizacionOpen()).toBeNull();
    expect(ordenesService.finalizar).not.toHaveBeenCalled();
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
      puedeRealizarAcciones: (type === 'Visita Técnica' || type === 'Instalación') && status !== 'Completada',
      esResponsable: type === 'Visita Técnica' || type === 'Instalación',
    };
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
