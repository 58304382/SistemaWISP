import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { API_BASE_URL } from '../../../../core/config/api.config';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Instalacion } from '../../../instalaciones/models/instalacion.models';
import { InstalacionesService } from '../../../instalaciones/services/instalaciones.service';
import { OrdenTrabajo } from '../../../ordenes-trabajo/models/orden-trabajo.models';
import { OrdenesTrabajoService } from '../../../ordenes-trabajo/services/ordenes-trabajo.service';
import { CotizacionesService } from '../../../cotizaciones/services/cotizaciones.service';
import {
  CotizacionVista,
  cotizacionResponseAVista,
} from '../../../cotizaciones/models/cotizacion.models';
import {
  EvaluacionVisita,
  VisitaTecnica,
} from '../../../visitas-tecnicas/models/visita-tecnica.models';
import { Tarea } from '../../models/tarea.models';
import { TareasService } from '../../services/tareas.service';
import { VisitasTecnicasService } from '../../../visitas-tecnicas/services/visitas-tecnicas.service';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { TicketDetalle } from '../../../soporte-tecnico/models/ticket.models';
import { TicketsService } from '../../../soporte-tecnico/services/tickets.service';
import { TicketDetalleComponent } from '../../../soporte-tecnico/components/ticket-detalle/ticket-detalle.component';
import { FinalizarSoporteComponent } from '../../../soporte-tecnico/components/finalizar-soporte/finalizar-soporte.component';

import { CompletarInstalacionComponent } from '../completar-instalacion/completar-instalacion.component';
import { EvaluacionVisitaComponent } from '../evaluacion-visita/evaluacion-visita.component';
import type { EvaluacionTecnica } from '../evaluacion-visita/evaluacion-visita.component';

export type TipoTarea = 'Instalación' | 'Visita Técnica' | 'Orden de Trabajo' | 'Soporte Técnico';
export type EstadoTarea = 'Programada' | 'En Proceso' | 'Completada';

// Modelo visual compartido por visitas reales e instalaciones, sin crear una entidad Tarea.
export interface TareaTecnicaRow {
  id: number;
  // ID de soporte independiente de visitas, instalaciones y órdenes con IDs coincidentes.
  id_ticket?: number | null;
  codigoTicket?: string | null;
  id_visita: number | null;
  id_instalacion: number | null;
  id_cliente?: number;
  id_ubicacion: number | null;
  numeroPropiedad?: number | null;
  direccionPropiedad?: string | null;
  referenciaPropiedad?: string | null;
  fotoFachada?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  id_empleado?: number;
  id_tipo_instalacion?: number;
  tipo: TipoTarea;
  fecha: string;
  hora: string;
  cliente: string;
  tipoInstalacion: string;
  tecnico: string;
  descripcion?: string;
  materiales?: EvaluacionVisita['materiales'];
  tecnicos?: string[];
  encargado?: string;
  estado: EstadoTarea;
  puedeVer?: boolean;
  puedeRealizarAcciones?: boolean;
  esResponsable?: boolean;
  soloLectura?: boolean;
  bloqueada?: boolean;
  reparacionAutorizada?: boolean;
  trabajoRechazado?: boolean;
  tieneEvaluacion?: boolean;
  tieneFinalizacion?: boolean;
  puedeFinalizarOrden?: boolean;
  reparacionEnEjecucion?: boolean;
  evaluacion?: EvaluacionTecnica;
  // Cotización vigente de la orden, para solicitar trabajo adicional sobre ella.
  idCotizacion?: number | null;
  trabajoAdicionalEnRevision?: boolean;
  trabajoAdicionalRechazado?: boolean;
}

interface GrupoTareas {
  fecha: string;
  etiqueta: string;
  tareas: TareaTecnicaRow[];
}

export interface MapNavigationTarget {
  id_ubicacion: number;
  numeroPropiedad: number | null;
  latitud: number;
  longitud: number;
}

// Fila editable de un material/repuesto de la evaluación de una orden.
export interface MaterialOrdenRow {
  descripcion: string;
  cantidad: string;
  unidad: string;
}

@Component({
  selector: 'app-tareas',
  imports: [CompletarInstalacionComponent, EvaluacionVisitaComponent, CurrencyPipe, DatePipe, TicketDetalleComponent, FinalizarSoporteComponent],
  templateUrl: './tareas.component.html',
  styleUrl: './tareas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareasComponent implements OnInit {
  private readonly visitasService = inject(VisitasTecnicasService);
  private readonly tareasService = inject(TareasService);
  private readonly instalacionesService = inject(InstalacionesService);
  private readonly ordenesService = inject(OrdenesTrabajoService);
  private readonly cotizacionesService = inject(CotizacionesService);
  private readonly clientesService = inject(ClientesService);
  private readonly router = inject(Router);
  private readonly ticketsService = inject(TicketsService);

  // Las acciones de soporte conservan su propio estado para no interferir con otras tareas.
  readonly startingSupportId = signal<number | null>(null);
  readonly supportToComplete = signal<TareaTecnicaRow | null>(null);
  readonly supportDetailId = signal<number | null>(null);
  readonly viewedSupport = signal<TicketDetalle | null>(null);
  readonly loadingSupportDetail = signal(false);
  readonly supportDetailError = signal('');
  private supportDetailRequest = 0;

  readonly tasks = signal<TareaTecnicaRow[]>([]);
  readonly isLoadingTasks = signal(false);
  readonly loadError = signal('');
  readonly searchTerm = signal('');
  readonly typeFilter = signal<'all' | TipoTarea>('all');
  readonly statusFilter = signal<'all' | EstadoTarea>('all');
  readonly installationToStart = signal<TareaTecnicaRow | null>(null);
  readonly startingInstallationId = signal<number | null>(null);
  readonly installationToComplete = signal<TareaTecnicaRow | null>(null);
  readonly installationDetailId = signal<number | null>(null);
  readonly viewedInstallation = signal<Instalacion | null>(null);
  readonly loadingInstallationDetail = signal(false);
  readonly installationDetailError = signal('');
  private installationDetailRequest = 0;
  readonly installationMapUrl = computed(() => {
    const location = this.viewedInstallation()?.ubicacion;
    if (location?.latitud == null || location.longitud == null) return null;
    const lat = Number(location.latitud);
    const lng = Number(location.longitud);
    // Solo coordenadas reales y válidas generan enlace; no concede permisos sobre Mapas.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const destination = encodeURIComponent(`${lat},${lng}`);
    // Conserva el formato de navegación que utiliza el módulo Mapas.
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  });
  readonly visitForEvaluation = signal<TareaTecnicaRow | null>(null);
  readonly actionMessage = signal('');
  readonly mapNavigationTarget = signal<MapNavigationTarget | null>(null);
  private readonly todayKey = this.toDateKey(new Date());
  private evaluationRequestId: number | null = null;

  // ==========================================
  // ESTADO DE ACCIONES SOBRE ÓRDENES DE TRABAJO
  // ==========================================
  readonly orderToStart = signal<TareaTecnicaRow | null>(null);
  readonly startingOrderId = signal<number | null>(null);
  readonly viewedOrder = signal<OrdenTrabajo | null>(null);
  // Datos complementarios del detalle «Ver» del técnico, fuera del DTO de la orden:
  // el teléfono del cliente y la cotización vigente (con su Proforma).
  readonly viewedOrderClientPhone = signal<string | null>(null);
  readonly viewedOrderCotizacion = signal<CotizacionVista | null>(null);
  readonly orderEvaluationOpen = signal(false);
  readonly evaluationOrderId = signal<number | null>(null);
  readonly orderEvalStep = signal<1 | 2>(1);
  readonly evaluationDiagnostico = signal('');
  readonly evaluationTrabajoPropuesto = signal('');
  readonly evaluationObservaciones = signal('');
  readonly orderEvalMateriales = signal<MaterialOrdenRow[]>([]);
  readonly isSavingEvaluation = signal(false);
  readonly evaluationError = signal('');

  // ==========================================
  // ESTADO DE «TRABAJO TERMINADO» (FINALIZACIÓN TÉCNICA)
  // ==========================================
  readonly orderFinalizacionOpen = signal<number | null>(null);
  readonly finalizacionTrabajo = signal('');
  readonly finalizacionResultado = signal('');
  readonly finalizacionObservaciones = signal('');
  readonly entregaConfirmada = signal(false);
  readonly isSavingFinalizacion = signal(false);
  readonly finalizacionError = signal('');
  // Marcador de sesión: la reparación pasa de «continuar» a «en ejecución» cuando
  // el técnico confirma Continuar trabajo. No requiere columna en la base.
  readonly reparacionEnEjecucionIds = signal<Set<number>>(new Set());

  // ==========================================
  // ESTADO DE «ACTUALIZAR COTIZACIÓN» (TRABAJO ADICIONAL)
  // ==========================================
  // El identificador guardado es el de la cotización que se reabre; el de la orden
  // permite actualizar la tarjeta cuando responde FastAPI.
  readonly trabajoAdicionalOpen = signal<number | null>(null);
  readonly trabajoAdicionalOrdenId = signal<number | null>(null);
  readonly trabajoAdicionalMateriales = signal<MaterialOrdenRow[]>([]);
  readonly isSavingTrabajoAdicional = signal(false);
  readonly trabajoAdicionalError = signal('');
  // Marcador de sesión: la cotización quedó en revisión comercial tras enviarse.
  readonly trabajoAdicionalEnRevisionIds = signal<Set<number>>(new Set());

  /** Carga la proyección autorizada de visitas e instalaciones. */
  ngOnInit(): void {
    this.loadTasks();
  }

  // Conserva también el historial recibido; ocultarlo haría desaparecer tareas reales al recargar.
  readonly upcomingTasks = computed(() =>
    [...this.tasks()].sort((left, right) => this.compareTasks(left, right)),
  );

  // Los contadores resumen el tablero completo y no cambian al aplicar filtros visuales.
  readonly statusCounts = computed(() => {
    const counts: Record<EstadoTarea, number> = {
      Programada: 0,
      'En Proceso': 0,
      Completada: 0,
    };
    for (const task of this.upcomingTasks()) {
      counts[task.estado] += 1;
    }
    return counts;
  });

  // La búsqueda combina los datos visibles de la tarjeta; los selectores restringen tipo y proceso.
  readonly filteredTasks = computed(() => {
    const query = this.normalize(this.searchTerm());
    const type = this.typeFilter();
    const status = this.statusFilter();
    return this.upcomingTasks().filter((task) => {
      const searchable = this.normalize(
        `${task.cliente} ${task.tecnico} ${task.tecnicos?.join(' ') ?? ''} ${task.encargado ?? ''} ${task.fecha} ${this.formatDate(task.fecha)}`,
      );
      return (
        searchable.includes(query) &&
        (type === 'all' || task.tipo === type) &&
        (status === 'all' || task.estado === status)
      );
    });
  });

  // Agrupa después de ordenar para conservar la prioridad temporal también con filtros activos.
  readonly taskGroups = computed<GrupoTareas[]>(() => {
    const groups = new Map<string, TareaTecnicaRow[]>();
    for (const task of this.filteredTasks()) {
      const dayTasks = groups.get(task.fecha) ?? [];
      dayTasks.push(task);
      groups.set(task.fecha, dayTasks);
    }
    return Array.from(groups, ([fecha, tareas]) => ({
      fecha,
      etiqueta: this.dateHeading(fecha),
      tareas,
    }));
  });

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  onTypeFilter(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.typeFilter.set(select.value as 'all' | TipoTarea);
    }
  }

  onStatusFilter(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.statusFilter.set(select.value as 'all' | EstadoTarea);
    }
  }

  // Presenta al encargado cuando existe; si no, conserva uno o varios técnicos sin crear IDs paralelos.
  technicianLabel(task: TareaTecnicaRow): string {
    return task.encargado ? 'Encargado' : task.tecnicos?.length ? 'Técnicos' : 'Técnico';
  }

  technicianDisplay(task: TareaTecnicaRow): string {
    return task.encargado ?? task.tecnicos?.join(', ') ?? task.tecnico;
  }

  /** Abre el detalle persistido de una visita sin habilitar ninguna mutación. */
  openVisitDetails(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Visita Técnica' || !task.puedeVer || task.id_visita === null) {
      return;
    }
    this.loadError.set('');
    const idVisita = task.id_visita;
    this.visitasService.getById(idVisita).subscribe({
      next: (visit) => {
        this.visitForEvaluation.set({
          ...task,
          cliente: visit.nombre_cliente,
          fecha: visit.fecha_programada,
          hora: visit.hora_programada.slice(0, 5),
          tecnico: visit.nombre_tecnico,
          tipoInstalacion: visit.nombre_tipo_instalacion,
          descripcion: visit.motivo_visita,
          evaluacion: visit.evaluacion ? this.toVisualEvaluation(visit.evaluacion) : undefined,
          soloLectura: true,
        });
      },
      error: (error: unknown) => {
        this.loadError.set(
          getApiErrorMessage(error, 'No fue posible cargar el detalle de la visita.'),
        );
      },
    });
  }

  // Solo una instalación Programada y ejecutable puede abrir la confirmación de inicio.
  openStartInstallation(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Instalación' || task.estado !== 'Programada' || task.bloqueada || !task.puedeRealizarAcciones) {
      return;
    }
    this.installationToStart.set(task);
  }

  closeStartInstallation(): void {
    if (this.startingInstallationId() === null) this.installationToStart.set(null);
  }

  // Solo actualiza la tarjeta tras recibir la transición persistida por FastAPI.
  confirmStartInstallation(): void {
    const selected = this.installationToStart();
    if (
      !selected ||
      selected.tipo !== 'Instalación' ||
      selected.estado !== 'Programada' ||
      selected.bloqueada || !selected.puedeRealizarAcciones ||
      selected.id_instalacion === null ||
      this.startingInstallationId() !== null
    ) {
      return;
    }
    this.loadError.set('');
    this.startingInstallationId.set(selected.id_instalacion);
    this.instalacionesService.start(selected.id_instalacion)
      .pipe(finalize(() => this.startingInstallationId.set(null)))
      .subscribe({
        next: (installation) => {
          this.replaceInstallationTask(installation);
          this.installationToStart.set(null);
          this.actionMessage.set(`Instalación #${installation.id_instalacion} iniciada correctamente.`);
        },
        error: (error: unknown) => this.loadError.set(getApiErrorMessage(error, 'No fue posible iniciar la instalación.')),
      });
  }

  /** Refleja el cierre confirmado, manteniendo el historial y el contexto de la visita. */
  onInstallationCompleted(installation: Instalacion): void {
    this.replaceInstallationTask(installation);
    this.installationToComplete.set(null);
    this.actionMessage.set(`Instalación #${installation.id_instalacion} completada correctamente.`);
  }

  private replaceInstallationTask(installation: Instalacion): void {
    this.tasks.update((tasks) => tasks.map((task) =>
      task.tipo !== 'Instalación' || task.id_instalacion !== installation.id_instalacion ? task : {
        ...task,
        estado: installation.estado,
        descripcion: installation.visita?.descripcion_evaluacion ?? task.descripcion,
        materiales: installation.visita?.materiales ?? task.materiales,
        puedeRealizarAcciones: task.puedeRealizarAcciones && installation.estado !== 'Completada',
      },
    ));
  }

  // Programada abre un formulario nuevo; los otros estados recuperan la única evaluación por id_visita.
  openVisitEvaluation(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Visita Técnica' || !task.puedeRealizarAcciones) {
      return;
    }
    if (task.id_visita === null) {
      this.loadError.set('La visita seleccionada no tiene un identificador válido.');
      return;
    }
    this.loadError.set('');
    if (task.estado === 'Programada') {
      this.evaluationRequestId = null;
      this.visitForEvaluation.set(task);
      return;
    }

    const idVisita = task.id_visita;
    this.evaluationRequestId = idVisita;
    this.visitasService.getEvaluation(idVisita).subscribe({
      next: (evaluation) => {
        if (this.evaluationRequestId !== idVisita) {
          return;
        }
        this.visitForEvaluation.set({
          ...task,
          evaluacion: this.toVisualEvaluation(evaluation),
        });
      },
      error: (error: unknown) => {
        if (this.evaluationRequestId !== idVisita) {
          return;
        }
        this.loadError.set(
          getApiErrorMessage(error, 'No fue posible cargar la evaluación de la visita.'),
        );
      },
    });
  }

  /** Cierra el modal y descarta cualquier respuesta atrasada de evaluación. */
  closeVisitEvaluation(): void {
    this.evaluationRequestId = null;
    this.visitForEvaluation.set(null);
  }

  // ==========================================
  // ACCIONES SOBRE ÓRDENES DE TRABAJO
  // ==========================================

  /** Ver, detalle e inicio de una orden: la visibilidad parte de la tarea autenticada. */
  openTaskDetails(task: TareaTecnicaRow): void {
    if (task.tipo === 'Soporte Técnico') {
      this.openSupportDetails(task);
      return;
    }
    if (task.tipo === 'Instalación') {
      this.openInstallationDetails(task);
      return;
    }
    if (task.tipo === 'Visita Técnica') {
      this.openVisitDetails(task);
      return;
    }
    if (task.tipo === 'Orden de Trabajo' && task.puedeVer) {
      // Se transfiere la cotización vigente ya expuesta por Tareas para no
      // depender de una nueva búsqueda en el módulo comercial.
      this.openOrderDetails(task.id, task.idCotizacion ?? null);
    }
  }

  /** Consulta el detalle persistido sin depender de las capacidades de inicio/cierre.
   * FastAPI valida nuevamente JWT, permiso e identidad del equipo asignado. */
  private openInstallationDetails(task: TareaTecnicaRow): void {
    if (!task.puedeVer || task.id_instalacion === null || !Number.isInteger(task.id_instalacion) || task.id_instalacion <= 0) return;
    const request = ++this.installationDetailRequest;
    this.installationDetailId.set(task.id_instalacion);
    this.viewedInstallation.set(null);
    this.installationDetailError.set('');
    this.loadingInstallationDetail.set(true);
    this.instalacionesService.getById(task.id_instalacion)
      .pipe(finalize(() => { if (request === this.installationDetailRequest) this.loadingInstallationDetail.set(false); }))
      .subscribe({
        next: (installation) => {
          if (request === this.installationDetailRequest) this.viewedInstallation.set(installation);
        },
        error: (error: unknown) => {
          if (request === this.installationDetailRequest) this.installationDetailError.set(
            getApiErrorMessage(error, 'No fue posible consultar el detalle de la instalación.'),
          );
        },
      });
  }

  /** Cerrar solo descarta la vista y evita que una respuesta tardía vuelva a abrirla. */
  closeInstallationDetails(): void {
    this.installationDetailRequest++;
    this.installationDetailId.set(null);
    this.viewedInstallation.set(null);
    this.loadingInstallationDetail.set(false);
    this.installationDetailError.set('');
  }

  /** La tarjeta no sustituye la autorización de asignación que FastAPI aplica al detalle existente. */
  private openSupportDetails(task: TareaTecnicaRow): void {
    if (!task.puedeVer || !task.id_ticket) return;
    const request = ++this.supportDetailRequest;
    this.supportDetailId.set(task.id_ticket); this.viewedSupport.set(null);
    this.loadingSupportDetail.set(true); this.supportDetailError.set('');
    this.ticketsService.getById(task.id_ticket).pipe(finalize(() => {
      if (request === this.supportDetailRequest) this.loadingSupportDetail.set(false);
    })).subscribe({
      next: (ticket) => {
        if (request !== this.supportDetailRequest) return;
        this.viewedSupport.set(ticket); this.replaceSupportTask(ticket);
      },
      error: (error: unknown) => {
        if (request === this.supportDetailRequest) this.supportDetailError.set(getApiErrorMessage(error, 'No fue posible consultar el soporte.'));
      },
    });
  }

  closeSupportDetails(): void {
    this.supportDetailRequest++; this.supportDetailId.set(null); this.viewedSupport.set(null);
    this.loadingSupportDetail.set(false); this.supportDetailError.set('');
  }

  /** Solo el responsable habilitado inicia; no modifica la tarjeta hasta recibir confirmación persistida. */
  startSupport(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Soporte Técnico' || !task.id_ticket || task.estado !== 'Programada' ||
        !task.esResponsable || !task.puedeRealizarAcciones || task.bloqueada || this.startingSupportId() !== null) return;
    this.startingSupportId.set(task.id_ticket); this.loadError.set('');
    this.ticketsService.start(task.id_ticket).pipe(finalize(() => this.startingSupportId.set(null))).subscribe({
      next: (ticket) => { this.replaceSupportTask(ticket); this.actionMessage.set(`${ticket.codigo} iniciado correctamente.`); },
      error: (error: unknown) => this.loadError.set(getApiErrorMessage(error, 'No fue posible iniciar el soporte.')),
    });
  }

  /** Abre el informe únicamente en En Proceso, sin afectar el formulario de otras tareas. */
  openCompleteSupport(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Soporte Técnico' || !task.id_ticket || task.estado !== 'En Proceso' ||
        !task.esResponsable || !task.puedeRealizarAcciones || task.bloqueada) return;
    this.supportToComplete.set(task);
  }

  onSupportCompleted(ticket: TicketDetalle): void {
    this.replaceSupportTask(ticket); this.supportToComplete.set(null);
    this.actionMessage.set(`${ticket.codigo} completado correctamente.`);
  }

  /** Actualiza solo la fuente soporte con estado real; nunca confunde IDs de otros módulos. */
  private replaceSupportTask(ticket: TicketDetalle): void {
    const estado = ticket.estado;
    if (estado !== 'Programada' && estado !== 'En Proceso' && estado !== 'Completada') return;
    this.tasks.update((tasks) => tasks.map((task) => task.tipo !== 'Soporte Técnico' || task.id_ticket !== ticket.id_ticket ? task : {
      ...task, estado, descripcion: ticket.asunto, tipoInstalacion: ticket.categoria,
      tecnico: ticket.tecnico ?? task.tecnico, puedeRealizarAcciones: Boolean(task.esResponsable && !task.bloqueada && estado !== 'Completada'),
    }));
  }

  /** Abre el detalle persistido de una orden en solo lectura. */
  openOrderDetails(idOrden: number, idCotizacion: number | null = null): void {
    this.loadError.set('');
    this.viewedOrderClientPhone.set(null);
    this.viewedOrderCotizacion.set(null);
    this.ordenesService.getById(idOrden).subscribe({
      next: (orden) => {
        this.viewedOrder.set(orden);
        this.loadViewedOrderExtras(orden, idCotizacion);
      },
      error: (error: unknown) => {
        this.loadError.set(
          getApiErrorMessage(error, 'No fue posible cargar el detalle de la orden.'),
        );
      },
    });
  }

  /** Carga teléfono del cliente y cotización de la orden para el detalle «Ver».

   * El teléfono proviene del módulo Clientes (requerido por Tareas). La cotización
   * se consulta solo si el técnico tiene acceso al módulo comercial; ante un 403
   * se omite en silencio para no romper el detalle, respetando sus permisos. */
  private loadViewedOrderExtras(orden: OrdenTrabajo, idCotizacion: number | null): void {
    this.clientesService.getById(orden.id_cliente).subscribe({
      next: (cliente) => this.viewedOrderClientPhone.set(cliente.telefono),
      error: () => this.viewedOrderClientPhone.set(null),
    });
    if (idCotizacion === null) {
      return;
    }
    this.cotizacionesService.getById(idCotizacion).subscribe({
      next: (dto) => this.viewedOrderCotizacion.set(cotizacionResponseAVista(dto)),
      error: () => this.viewedOrderCotizacion.set(null),
    });
  }

  closeOrderDetails(): void {
    this.viewedOrder.set(null);
    this.viewedOrderClientPhone.set(null);
    this.viewedOrderCotizacion.set(null);
  }

  /** Una orden Programada puede iniciarse por el técnico responsable o el administrador. */
  openOrderStart(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Orden de Trabajo' ||
      task.estado !== 'Programada' ||
      !task.puedeRealizarAcciones
    ) {
      return;
    }
    this.orderToStart.set(task);
  }

  closeOrderStart(): void {
    this.orderToStart.set(null);
  }

  /** Confirma el inicio contra la API real; la orden pasa a En Proceso y se bloquea. */
  confirmOrderStart(): void {
    const task = this.orderToStart();
    if (!task || task.tipo !== 'Orden de Trabajo' || this.startingOrderId() !== null) {
      return;
    }
    this.loadError.set('');
    this.startingOrderId.set(task.id);
    this.ordenesService
      .start(task.id)
      .pipe(finalize(() => this.startingOrderId.set(null)))
      .subscribe({
        next: (orden) => {
          this.replaceOrderTask(orden);
          this.closeOrderStart();
          this.actionMessage.set(`La orden ID ${orden.id_orden} inició correctamente.`);
        },
        error: (error: unknown) => {
          this.actionMessage.set('');
          this.loadError.set(getApiErrorMessage(error, 'No fue posible iniciar la orden.'));
        },
      });
  }

  /** Abre el formulario de evaluación técnica de una orden En Proceso asignada. */
  openOrderEvaluation(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Orden de Trabajo' ||
      task.estado !== 'En Proceso' ||
      !task.puedeRealizarAcciones
    ) {
      return;
    }
    this.loadError.set('');
    this.evaluationError.set('');
    this.evaluationOrderId.set(task.id);
    this.orderEvalStep.set(1);
    this.evaluationDiagnostico.set('');
    this.evaluationTrabajoPropuesto.set('');
    this.evaluationObservaciones.set('');
    this.orderEvalMateriales.set([]);
    this.evaluationRequestId = task.id;
    this.ordenesService.getEvaluacion(task.id).subscribe({
      next: (evaluation) => {
        if (this.evaluationRequestId !== task.id) {
          return;
        }
        this.evaluationDiagnostico.set(evaluation.diagnostico);
        this.evaluationTrabajoPropuesto.set(evaluation.trabajo_propuesto);
        this.evaluationObservaciones.set(evaluation.observaciones ?? '');
        this.orderEvalMateriales.set(
          evaluation.materiales.map((material) => ({
            descripcion: material.descripcion,
            cantidad: String(material.cantidad),
            unidad: material.unidad ?? '',
          })),
        );
        this.orderEvaluationOpen.set(true);
      },
      error: (error: unknown) => {
        if (this.evaluationRequestId !== task.id) {
          return;
        }
        if (error instanceof HttpErrorResponse && error.status === 404) {
          // Sin evaluación previa se abre el formulario para crearla.
          this.orderEvaluationOpen.set(true);
          return;
        }
        this.loadError.set(getApiErrorMessage(error, 'No fue posible cargar la evaluación.'));
      },
    });
  }

  closeOrderEvaluation(): void {
    this.evaluationRequestId = null;
    this.orderEvaluationOpen.set(false);
    this.evaluationOrderId.set(null);
    this.orderEvalStep.set(1);
    this.orderEvalMateriales.set([]);
  }

  onOrderEvalField(
    field: 'diagnostico' | 'trabajo_propuesto' | 'observaciones',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = {
      diagnostico: this.evaluationDiagnostico,
      trabajo_propuesto: this.evaluationTrabajoPropuesto,
      observaciones: this.evaluationObservaciones,
    }[field];
    target.set(input.value);
  }

  addOrderMaterial(): void {
    this.orderEvalMateriales.update((materiales) => [
      ...materiales,
      { descripcion: '', cantidad: '', unidad: '' },
    ]);
  }

  removeOrderMaterial(index: number): void {
    this.orderEvalMateriales.update((materiales) =>
      materiales.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  onOrderMaterialField(
    index: number,
    field: 'descripcion' | 'cantidad' | 'unidad',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    this.orderEvalMateriales.update((materiales) =>
      materiales.map((material, itemIndex) =>
        itemIndex === index ? { ...material, [field]: input.value } : material,
      ),
    );
  }

  /** Indica si la fila del formulario no tiene ningún dato capturado. */
  private filaMaterialVacia(material: MaterialOrdenRow): boolean {
    return !material.descripcion.trim() && !material.cantidad.trim() && !material.unidad.trim();
  }

  /** Valida una fila de material contra el contrato de FastAPI (sin redondear ni
   * descartar); devuelve el mensaje específico del campo o null si es válida. */
  private errorMaterial(material: MaterialOrdenRow): string | null {
    const descripcion = material.descripcion.trim();
    if (!descripcion) {
      return 'completa la descripción del material o repuesto.';
    }
    if (descripcion.length > 200) {
      return 'la descripción permite máximo 200 caracteres.';
    }
    const cantidad = material.cantidad.trim();
    if (!cantidad) {
      return 'indica la cantidad del material o repuesto.';
    }
    const numero = Number(cantidad);
    if (!Number.isFinite(numero)) {
      return 'la cantidad debe ser un número válido.';
    }
    if (numero <= 0) {
      return 'la cantidad debe ser mayor a 0.';
    }
    if (this.decimalesDe(cantidad) > 2) {
      return 'la cantidad permite máximo 2 decimales.';
    }
    if (this.digitosDe(cantidad) > 10) {
      return 'la cantidad permite máximo 10 dígitos.';
    }
    const unidad = material.unidad.trim();
    if (unidad.length > 30) {
      return 'la unidad permite máximo 30 caracteres.';
    }
    return null;
  }

  /** Recorre las filas con datos y devuelve el primer error de material específico. */
  private validarMaterialesConMensaje(materiales: MaterialOrdenRow[]): string | null {
    let numero = 0;
    for (const material of materiales) {
      if (this.filaMaterialVacia(material)) {
        continue;
      }
      numero += 1;
      const error = this.errorMaterial(material);
      if (error) {
        return `Material ${numero}: ${error}`;
      }
    }
    return null;
  }

  private decimalesDe(valor: string): number {
    const partes = valor.split('.');
    return partes.length > 1 ? partes[1].length : 0;
  }

  private digitosDe(valor: string): number {
    const [entero, decimales = ''] = valor.split('.');
    const enteros = (entero.replace(/[^\d]/g, '').replace(/^0+/, '') || '0').length;
    return enteros + decimales.length;
  }

  /** Valida el paso 1 y avanza al resumen; no persiste nada todavía. */
  goToEvaluationSummary(): void {
    const diagnostico = this.evaluationDiagnostico().trim();
    const trabajoPropuesto = this.evaluationTrabajoPropuesto().trim();
    if (!diagnostico || !trabajoPropuesto) {
      this.evaluationError.set('Completa el diagnóstico y el trabajo propuesto.');
      return;
    }
    const errorMateriales = this.validarMaterialesConMensaje(this.orderEvalMateriales());
    if (errorMateriales) {
      this.evaluationError.set(errorMateriales);
      return;
    }
    this.evaluationError.set('');
    this.orderEvalStep.set(2);
  }

  goBackToEvaluationInfo(): void {
    this.evaluationError.set('');
    this.orderEvalStep.set(1);
  }

  /** Guarda la evaluación de la orden (una sola vez, sin duplicados) y la deja
   * pendiente de cotizar; la ausencia de cotización asociada define el pendiente. */
  saveOrderEvaluation(): void {
    const idOrden = this.evaluationOrderId();
    if (idOrden === null || this.isSavingEvaluation()) {
      return;
    }
    const diagnostico = this.evaluationDiagnostico().trim();
    const trabajoPropuesto = this.evaluationTrabajoPropuesto().trim();
    if (!diagnostico || !trabajoPropuesto) {
      this.evaluationError.set('Completa el diagnóstico y el trabajo propuesto.');
      return;
    }
    const errorMateriales = this.validarMaterialesConMensaje(this.orderEvalMateriales());
    if (errorMateriales) {
      this.evaluationError.set(errorMateriales);
      return;
    }
    // Solo las filas con datos se envían; una fila totalmente vacía no es un material.
    // Las filas inválidas no se descartan: el error anterior las bloquea.
    const materiales = this.orderEvalMateriales()
      .filter((material) => !this.filaMaterialVacia(material))
      .map((material) => ({
        descripcion: material.descripcion.trim(),
        cantidad: Number(material.cantidad),
        unidad: material.unidad.trim() || null,
      }));

    this.evaluationError.set('');
    this.isSavingEvaluation.set(true);
    this.ordenesService
      .registrarEvaluacion(idOrden, {
        diagnostico,
        trabajo_propuesto: trabajoPropuesto,
        observaciones: this.evaluationObservaciones().trim() || null,
        ...(materiales.length ? { materiales } : {}),
      })
      .pipe(finalize(() => this.isSavingEvaluation.set(false)))
      .subscribe({
        next: (orden) => {
          this.replaceOrderTask(orden);
          this.closeOrderEvaluation();
          this.actionMessage.set(
            `La evaluación de la orden ID ${orden.id_orden} fue enviada y quedará pendiente de cotizar en Cotizaciones.`,
          );
        },
        error: (error: unknown) => {
          this.evaluationError.set(
            getApiErrorMessage(error, 'No fue posible guardar la evaluación de la orden.'),
          );
        },
      });
  }

  /** Indica si la reparación de la orden ya fue «continuada» en esta sesión. */
  estaReparacionEnEjecucion(task: TareaTecnicaRow): boolean {
    return (
      task.reparacionEnEjecucion === true ||
      this.reparacionEnEjecucionIds().has(task.id)
    );
  }

  /** Etapa de una orden En Proceso para mostrar la acción correcta:
   * 'registrar' sin evaluación · 'rechazado' cotización rechazada ·
   * 'esperando' evaluada sin aceptación · 'continuar' aceptada aún no iniciada ·
   * 'en_ejecucion' reparación en curso ·
    * 'finalizado' registro técnico previo; entregar aún exige cotización COMPLETADA. */
  etapaOrden(task: TareaTecnicaRow):
    | 'registrar'
    | 'rechazado'
    | 'esperando'
    | 'continuar'
    | 'en_ejecucion'
    | 'finalizado' {
    if (!task.tieneEvaluacion) {
      return 'registrar';
    }
    // El rechazo comercial se avisa antes que la espera: no autoriza reparación.
    if (task.trabajoRechazado) {
      return 'rechazado';
    }
    if (!task.reparacionAutorizada) {
      return 'esperando';
    }
    if (task.tieneFinalizacion) {
      return 'finalizado';
    }
    return this.estaReparacionEnEjecucion(task) ? 'en_ejecucion' : 'continuar';
  }

  /** Avance de reparación mostrado en el detalle «Ver» del técnico.

   * Se deriva de datos ya persistidos en la orden (estado, evaluación y
   * finalización), sin agregar columnas ni estados nuevos. */
  avanceOrden(orden: OrdenTrabajo): string {
    if (orden.estado === 'Completada') {
      return 'Orden completada · trabajo finalizado';
    }
    if (orden.finalizacion) {
      return 'Entrega pendiente · orden En Proceso';
    }
    if (orden.trabajo_rechazado) {
      return 'Cotización rechazada · reparación no autorizada';
    }
    if (!orden.evaluacion) {
      return 'Pendiente de evaluación técnica';
    }
    if (orden.estado === 'En Proceso' && orden.reparacion_autorizada) {
      return 'Reparación autorizada y en ejecución';
    }
    return 'Evaluación registrada · pendiente de autorización comercial';
  }

  /** Valida con el backend que el técnico asignado puede continuar la reparación. */
  continuarTrabajo(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Orden de Trabajo' ||
      task.estado !== 'En Proceso' ||
      !task.puedeRealizarAcciones ||
      !task.reparacionAutorizada
    ) {
      return;
    }
    this.loadError.set('');
    this.ordenesService.continuar(task.id).subscribe({
      next: (orden) => {
        // Al confirmar, la reparación pasa a «en ejecución» en esta sesión:
        // habilita trabajo adicional sin sustituir la entrega autorizada desde Cobros.
        this.reparacionEnEjecucionIds.update((ids) => new Set(ids).add(orden.id_orden));
        this.replaceOrderTask(orden);
        this.actionMessage.set(
          `La reparación de la orden ID ${orden.id_orden} está en ejecución. Confirma la entrega desde Finalizar orden cuando la cotización esté COMPLETADA en Cobros.`,
        );
      },
      error: (error: unknown) =>
        this.loadError.set(getApiErrorMessage(error, 'No fue posible continuar la reparación.')),
    });
  }

  /** Confirma la entrega con autorización de Cobros, incluido Pago pendiente sin dinero. */
  openOrderFinalizacion(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Orden de Trabajo' ||
      task.estado !== 'En Proceso' ||
      !task.puedeRealizarAcciones ||
      !task.esResponsable ||
      !task.puedeFinalizarOrden
    ) {
      return;
    }
    this.finalizacionError.set('');
    this.finalizacionTrabajo.set('');
    this.finalizacionResultado.set('');
    this.finalizacionObservaciones.set('');
    this.entregaConfirmada.set(false);
    this.orderFinalizacionOpen.set(task.id);
  }

  closeOrderFinalizacion(): void {
    if (!this.isSavingFinalizacion()) this.orderFinalizacionOpen.set(null);
  }

  /** La casilla acredita la confirmación explícita de entrega del teléfono o computadora. */
  onEntregaConfirmada(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.entregaConfirmada.set(event.target.checked);
  }

  onFinalizacionField(
    field: 'trabajo' | 'resultado' | 'observaciones',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = {
      trabajo: this.finalizacionTrabajo,
      resultado: this.finalizacionResultado,
      observaciones: this.finalizacionObservaciones,
    }[field];
    target.set(input.value);
  }

  /** Solo envía la entrega del responsable, evita doble envío y usa el estado persistido. */
  saveOrderFinalizacion(): void {
    const idOrden = this.orderFinalizacionOpen();
    if (idOrden === null || this.isSavingFinalizacion()) {
      return;
    }
    const tarea = this.tasks().find((item) => item.tipo === 'Orden de Trabajo' && item.id === idOrden);
    if (!tarea?.puedeFinalizarOrden || !tarea.puedeRealizarAcciones || !tarea.esResponsable || tarea.estado !== 'En Proceso') return;
    if (!this.entregaConfirmada()) {
      this.finalizacionError.set('Confirme la entrega del teléfono o computadora al cliente.');
      return;
    }
    const trabajoRealizado = this.finalizacionTrabajo().trim();
    const resultadoSolucion = this.finalizacionResultado().trim();
    if (!trabajoRealizado || !resultadoSolucion) {
      this.finalizacionError.set(
        'Completa el trabajo realizado y el resultado de la solución.',
      );
      return;
    }
    this.finalizacionError.set('');
    this.isSavingFinalizacion.set(true);
    this.ordenesService
      .finalizar(idOrden, {
        trabajo_realizado: trabajoRealizado,
        resultado_solucion: resultadoSolucion,
        observaciones_finales: this.finalizacionObservaciones().trim() || null,
      })
      .pipe(finalize(() => this.isSavingFinalizacion.set(false)))
      .subscribe({
        next: (orden) => {
          if (orden.estado !== 'Completada') {
            this.finalizacionError.set('La entrega no quedó confirmada: la orden continúa En Proceso. Actualice y vuelva a intentarlo.');
            return;
          }
          this.replaceOrderTask(orden);
          this.orderFinalizacionOpen.set(null);
          this.actionMessage.set(
            `Entrega confirmada para la orden ID ${orden.id_orden}. Estado: ${orden.estado}.`,
          );
        },
        error: (error: unknown) =>
          this.finalizacionError.set(
            getApiErrorMessage(error, 'No fue posible confirmar la entrega y finalizar la orden.'),
          ),
      });
  }

  // ==========================================
  // ACTUALIZAR COTIZACIÓN (TRABAJO ADICIONAL)
  // ==========================================

  /** Indica si la cotización de la orden ya está en revisión comercial (sesión o API). */
  estaTrabajoAdicionalEnRevision(task: TareaTecnicaRow): boolean {
    return (
      task.trabajoAdicionalEnRevision === true ||
      this.trabajoAdicionalEnRevisionIds().has(task.id)
    );
  }

  /** El técnico puede actualizar la cotización mientras la orden siga abierta y
   * autorizada y no exista ya un trabajo adicional en revisión comercial. */
  puedeActualizarCotizacion(task: TareaTecnicaRow): boolean {
    return (
      task.tipo === 'Orden de Trabajo' &&
      task.estado === 'En Proceso' &&
      task.puedeRealizarAcciones === true &&
      task.reparacionAutorizada === true &&
      !this.estaTrabajoAdicionalEnRevision(task) &&
      typeof task.idCotizacion === 'number'
    );
  }

  /** Abre el formulario de trabajo adicional sobre la cotización vigente. */
  openTrabajoAdicional(task: TareaTecnicaRow): void {
    if (!this.puedeActualizarCotizacion(task) || typeof task.idCotizacion !== 'number') {
      return;
    }
    this.loadError.set('');
    this.trabajoAdicionalError.set('');
    this.trabajoAdicionalMateriales.set([]);
    this.trabajoAdicionalOrdenId.set(task.id);
    this.trabajoAdicionalOpen.set(task.idCotizacion);
  }

  closeTrabajoAdicional(): void {
    this.trabajoAdicionalOpen.set(null);
    this.trabajoAdicionalOrdenId.set(null);
    this.trabajoAdicionalMateriales.set([]);
    this.trabajoAdicionalError.set('');
  }

  addTrabajoAdicionalMaterial(): void {
    this.trabajoAdicionalMateriales.update((materiales) => [
      ...materiales,
      { descripcion: '', cantidad: '', unidad: '' },
    ]);
  }

  removeTrabajoAdicionalMaterial(index: number): void {
    this.trabajoAdicionalMateriales.update((materiales) =>
      materiales.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  onTrabajoAdicionalMaterialField(
    index: number,
    field: 'descripcion' | 'cantidad' | 'unidad',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    this.trabajoAdicionalMateriales.update((materiales) =>
      materiales.map((material, itemIndex) =>
        itemIndex === index ? { ...material, [field]: input.value } : material,
      ),
    );
  }

  /** Envía el trabajo adicional reutilizando la cotización vigente (sin precios).

   * Este formulario envia solo materiales/repuestos; no exige una descripcion
   * general ni agrega conceptos ficticios. FastAPI reabre la cotización
   * (ACEPTADA → EN PROCESO) conservando lo ya autorizado para que el administrador
   * fije los precios y la regenere. La orden no cambia de estado. */
  saveTrabajoAdicional(): void {
    const idCotizacion = this.trabajoAdicionalOpen();
    const idOrden = this.trabajoAdicionalOrdenId();
    if (idCotizacion === null || idOrden === null || this.isSavingTrabajoAdicional()) {
      return;
    }
    const errorMateriales = this.validarMaterialesConMensaje(
      this.trabajoAdicionalMateriales(),
    );
    if (errorMateriales) {
      this.trabajoAdicionalError.set(errorMateriales);
      return;
    }
    // Mantiene el contrato de detalles reales y sus validaciones por material.
    const detalles = this.trabajoAdicionalMateriales()
        .filter((material) => !this.filaMaterialVacia(material))
        .map((material) => ({
          descripcion: material.descripcion.trim(),
          cantidad: Number(material.cantidad),
          unidad: material.unidad.trim() || null,
        }));
    if (!detalles.length) {
      this.trabajoAdicionalError.set('Agregue al menos un material o repuesto para enviar a revisión.');
      return;
    }
    this.trabajoAdicionalError.set('');
    this.isSavingTrabajoAdicional.set(true);
    this.cotizacionesService
      .registrarTrabajoAdicional(idCotizacion, { detalles })
      .pipe(finalize(() => this.isSavingTrabajoAdicional.set(false)))
      .subscribe({
        next: () => {
          this.trabajoAdicionalEnRevisionIds.update((ids) => new Set(ids).add(idOrden));
          this.closeTrabajoAdicional();
          this.actionMessage.set(
            `Trabajo adicional enviado a revisión comercial para la orden ID ${idOrden}. La reparación ya autorizada continúa disponible.`,
          );
        },
        error: (error: unknown) => {
          this.trabajoAdicionalError.set(
            getApiErrorMessage(error, 'No fue posible registrar el trabajo adicional.'),
          );
        },
      });
  }

  /** Reemplaza una tarjeta de orden conservando las capacidades calculadas por Tareas. */
  private replaceOrderTask(orden: OrdenTrabajo): void {
    this.tasks.update((tasks) =>
      tasks.map((task) => {
        if (task.tipo !== 'Orden de Trabajo' || task.id !== orden.id_orden) {
          return task;
        }
        return {
          ...this.toOrderRow(orden),
          esResponsable: task.esResponsable,
          // Una orden completada conserva su detalle, pero ya no ofrece acciones técnicas.
          puedeRealizarAcciones: task.puedeRealizarAcciones && orden.estado !== 'Completada',
          puedeFinalizarOrden: task.puedeFinalizarOrden && orden.estado === 'En Proceso',
          bloqueada: task.bloqueada,
          // La cotización vigente y sus marcas no vienen en el DTO de la orden:
          // se conservan de la tarjeta para no perder el acceso al trabajo adicional.
          idCotizacion: task.idCotizacion ?? null,
          trabajoAdicionalEnRevision: task.trabajoAdicionalEnRevision,
          trabajoAdicionalRechazado: task.trabajoAdicionalRechazado,
        };
      }),
    );
  }

  /** Adapta una orden real al modelo visual compartido del tablero. */
  private toOrderRow(orden: OrdenTrabajo): TareaTecnicaRow {
    return {
      id: orden.id_orden,
      id_visita: null,
      id_instalacion: null,
      id_cliente: orden.id_cliente,
      id_ubicacion: null,
      tipo: 'Orden de Trabajo',
      fecha: orden.fecha_recepcion.slice(0, 10),
      hora: orden.fecha_recepcion.slice(11, 16),
      cliente: orden.nombre_cliente,
      tipoInstalacion: orden.nombre_tipo_trabajo,
      tecnico: orden.nombre_tecnico,
      descripcion: orden.titulo,
      estado: orden.estado,
      puedeVer: true,
      puedeRealizarAcciones: true,
      esResponsable: true,
      soloLectura: false,
      reparacionAutorizada: orden.reparacion_autorizada,
      trabajoRechazado: orden.trabajo_rechazado,
      tieneEvaluacion: orden.evaluacion !== null,
      tieneFinalizacion: orden.finalizacion !== null,
      reparacionEnEjecucion: false,
      bloqueada: false,
      // El DTO de la orden no expone la cotización ni las marcas de trabajo
      // adicional; replaceOrderTask conserva los valores de la tarjeta.
      idCotizacion: null,
      trabajoAdicionalEnRevision: false,
      trabajoAdicionalRechazado: false,
    };
  }

  /** Abre Mapas con el contexto real de la visita sin conceder acceso al mapa general. */
  goToVisitMap(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Visita Técnica' ||
      task.id_visita === null ||
      task.puedeVer === false ||
      (task.id_ubicacion === null && (task.estado !== 'En Proceso' || !task.puedeRealizarAcciones))
    ) {
      return;
    }
    void this.router.navigate(['/tareas', 'visitas', task.id_visita, 'mapa']);
  }

  /** Abre el mapa contextual de la instalación con su propiedad real y permiso de lectura. */
  prepareDirections(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Instalación' ||
      task.id_instalacion === null ||
      task.puedeVer === false ||
      task.id_ubicacion === null ||
      !this.hasGeographicCoordinates(task)
    ) {
      return;
    }
    this.mapNavigationTarget.set({
      id_ubicacion: task.id_ubicacion,
      numeroPropiedad: task.numeroPropiedad ?? null,
      latitud: task.latitud,
      longitud: task.longitud,
    });
    void this.router.navigate(['/tareas', 'instalaciones', task.id_instalacion, 'mapa']);
  }

  /** Descarta destinos incompletos, no finitos o fuera de los rangos geográficos. */
  hasGeographicCoordinates(
    task: TareaTecnicaRow,
  ): task is TareaTecnicaRow & { latitud: number; longitud: number } {
    return (
      task.latitud !== null &&
      task.latitud !== undefined &&
      task.longitud !== null &&
      task.longitud !== undefined &&
      Number.isFinite(task.latitud) &&
      Number.isFinite(task.longitud) &&
      Math.abs(task.latitud) <= 90 &&
      Math.abs(task.longitud) <= 180
    );
  }

  facadeUrl(path: string | null | undefined): string | null {
    if (!path) {
      return null;
    }
    return /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
  }

  /** Refleja el inicio confirmado sin cerrar el modal, para que un reintento no duplique la evaluación. */
  onVisitEvaluationProgressed(visit: VisitaTecnica): void {
    this.replaceVisitTask(visit);
    this.closeVisitEvaluation();
  }

  /** Reemplaza la visita finalizada y cierra el modal sin alterar las instalaciones del tablero. */
  onVisitEvaluationSaved(visit: VisitaTecnica): void {
    this.replaceVisitTask(visit);
    this.closeVisitEvaluation();
  }

  // La finalización solo se habilita para instalaciones En Proceso que no estén bloqueadas.
  openCompleteInstallation(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Instalación' || task.estado !== 'En Proceso' || task.bloqueada || !task.puedeRealizarAcciones) {
      return;
    }
    this.installationToComplete.set(task);
  }

  // Cancelar únicamente descarta el formulario; nunca altera el estado local de la tarea.
  closeCompleteInstallation(): void {
    this.installationToComplete.set(null);
  }

  /** Consulta la única fuente del tablero para no conservar instalaciones ficticias en memoria. */
  private loadTasks(): void {
    this.isLoadingTasks.set(true);
    this.loadError.set('');
    this.tareasService
      .getAll()
      .pipe(finalize(() => this.isLoadingTasks.set(false)))
      .subscribe({
        next: (tasks) => {
          this.tasks.set(tasks.map((task) => this.fromApiTask(task)));
        },
        error: (error: unknown) => {
          const forbiddenDetail =
            error instanceof HttpErrorResponse &&
            error.status === 403 &&
            typeof (error.error as { detail?: unknown } | null)?.detail === 'string'
              ? (error.error as { detail: string }).detail
              : null;
          this.loadError.set(
            forbiddenDetail ??
              getApiErrorMessage(error, 'No fue posible cargar las tareas asignadas.'),
          );
        },
      });
  }

  /** Adapta el DTO unificado a las tarjetas sin perder los IDs de cada fuente. */
  private fromApiTask(task: Tarea): TareaTecnicaRow {
    const lead = task.tecnicos.find((technician) => technician.es_encargado);
    const fallbackTechnician = task.tecnicos[0];
    return {
      id: task.id,
      id_ticket: task.id_ticket ?? null,
      codigoTicket: task.codigo_ticket ?? null,
      id_visita: task.id_visita,
      id_instalacion: task.id_instalacion,
      id_cliente: task.id_cliente,
      id_ubicacion: task.id_ubicacion,
      numeroPropiedad: task.numero_propiedad,
      direccionPropiedad: task.direccion_propiedad,
      referenciaPropiedad: task.referencia_propiedad,
      fotoFachada: task.foto_fachada,
      latitud: task.latitud,
      longitud: task.longitud,
      id_empleado: fallbackTechnician?.id_empleado,
      id_tipo_instalacion: task.id_tipo_instalacion ?? undefined,
      tipo: task.tipo,
      fecha: task.fecha,
      hora: task.hora.slice(0, 5),
      cliente: task.cliente,
      tipoInstalacion: task.tipo_instalacion ?? 'Sin especificar',
      tecnico: lead?.nombre ?? fallbackTechnician?.nombre ?? 'Sin técnico asignado',
      descripcion: task.descripcion ?? undefined,
      materiales: task.materiales ?? [],
      tecnicos:
        task.tipo === 'Instalación'
          ? task.tecnicos.map((technician) => technician.nombre)
          : undefined,
      encargado: task.tipo === 'Instalación' ? lead?.nombre : undefined,
      estado: task.estado,
      puedeVer: task.puede_ver,
      puedeRealizarAcciones: task.puede_realizar_acciones,
      esResponsable: task.es_responsable,
      bloqueada: task.bloqueada,
      reparacionAutorizada: task.reparacion_autorizada ?? false,
      trabajoRechazado: task.trabajo_rechazado ?? false,
      tieneEvaluacion: task.tiene_evaluacion ?? false,
      tieneFinalizacion: task.tiene_finalizacion ?? false,
      puedeFinalizarOrden: task.puede_finalizar_orden ?? false,
      idCotizacion: task.id_cotizacion ?? null,
      trabajoAdicionalEnRevision: task.trabajo_adicional_en_revision ?? false,
      trabajoAdicionalRechazado: task.trabajo_adicional_rechazado ?? false,
    };
  }

  /** Adapta el contrato de visita a la tarjeta existente conservando todos los IDs de origen. */
  private toTask(visit: VisitaTecnica): TareaTecnicaRow {
    return {
      id: visit.id_visita,
      id_visita: visit.id_visita,
      id_instalacion: null,
      id_cliente: visit.id_cliente,
      id_ubicacion: visit.id_ubicacion,
      numeroPropiedad: visit.numero_propiedad,
      id_empleado: visit.id_empleado,
      id_tipo_instalacion: visit.id_tipo_instalacion,
      tipo: 'Visita Técnica',
      fecha: visit.fecha_programada,
      hora: visit.hora_programada.slice(0, 5),
      cliente: visit.nombre_cliente,
      tipoInstalacion: visit.nombre_tipo_instalacion,
      tecnico: visit.nombre_tecnico,
      descripcion: visit.motivo_visita,
      estado: visit.estado,
      evaluacion: visit.evaluacion ? this.toVisualEvaluation(visit.evaluacion) : undefined,
    };
  }

  /** Convierte snake_case y materiales estructurados al modelo que ya consume el modal visual. */
  private toVisualEvaluation(evaluation: EvaluacionVisita): EvaluacionTecnica {
    return {
      descripcionTrabajo: evaluation.descripcion_trabajo,
      tecnicosRecomendados: evaluation.tecnicos_recomendados,
      materiales: evaluation.materiales.map((material) => material.descripcion),
      materialesDetalle: evaluation.materiales.map((material) => ({
        descripcion: material.descripcion,
        cantidad: material.cantidad,
        unidad: material.unidad,
      })),
      condicionesLugar: evaluation.condiciones_lugar,
      observacionTecnica: evaluation.observacion_tecnica,
      ubicacionRegistrada: false,
    };
  }

  /** Actualiza una sola tarjeta por id_visita y nunca confunde IDs de instalaciones. */
  private replaceVisitTask(visit: VisitaTecnica): void {
    this.tasks.update((tasks) =>
      tasks.map((task) => {
        if (task.tipo !== 'Visita Técnica' || task.id_visita !== visit.id_visita) {
          return task;
        }
        return {
          ...this.toTask(visit),
          puedeVer: task.puedeVer,
          esResponsable: task.esResponsable,
          puedeRealizarAcciones: task.esResponsable === true && visit.estado !== 'Completada',
          bloqueada: task.bloqueada,
          direccionPropiedad: task.direccionPropiedad,
          referenciaPropiedad: task.referenciaPropiedad,
          fotoFachada: task.fotoFachada,
          latitud: task.latitud,
          longitud: task.longitud,
        };
      }),
    );
  }

  // Prioriza hoy, luego el futuro ascendente y finalmente el pasado desde el más reciente.
  private compareTasks(left: TareaTecnicaRow, right: TareaTecnicaRow): number {
    const leftGroup = left.fecha === this.todayKey ? 0 : left.fecha > this.todayKey ? 1 : 2;
    const rightGroup = right.fecha === this.todayKey ? 0 : right.fecha > this.todayKey ? 1 : 2;
    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup;
    }
    if (left.fecha === right.fecha) {
      return left.hora.localeCompare(right.hora);
    }
    return leftGroup === 2
      ? right.fecha.localeCompare(left.fecha)
      : left.fecha.localeCompare(right.fecha);
  }

  // Distingue HOY y MAÑANA por días calendario para evitar diferencias causadas por la hora actual.
  private dateHeading(dateKey: string): string {
    const difference = this.calendarDayDifference(this.todayKey, dateKey);
    const formatted = this.formatDate(dateKey).toUpperCase();
    if (difference === 0) {
      return `HOY, ${formatted.replace(',', '')}`;
    }
    if (difference === 1) {
      return `MAÑANA · ${formatted}`;
    }
    return formatted;
  }

  private formatDate(dateKey: string): string {
    return new Intl.DateTimeFormat('es-GT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(this.parseDateKey(dateKey));
  }

  private calendarDayDifference(fromKey: string, toKey: string): number {
    const from = this.dateParts(fromKey);
    const to = this.dateParts(toKey);
    return Math.round(
      (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
        86_400_000,
    );
  }

  private parseDateKey(dateKey: string): Date {
    const { year, month, day } = this.dateParts(dateKey);
    return new Date(year, month - 1, day);
  }

  private dateParts(dateKey: string): { year: number; month: number; day: number } {
    const [year, month, day] = dateKey.split('-').map(Number);
    return { year, month, day };
  }

  private toDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
