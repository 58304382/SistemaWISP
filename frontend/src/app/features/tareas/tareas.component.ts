import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';

import { API_BASE_URL } from '../../core/config/api.config';
import { EvaluacionVisita, VisitaTecnica } from '../../core/models/visita-tecnica.models';
import { Tarea } from '../../core/models/tarea.models';
import { TareasService } from '../../core/services/tareas.service';
import { MapCoordinates } from '../../core/services/google-maps-loader.service';
import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { getApiErrorMessage } from '../../core/utils/api-error';

import { CompletarInstalacionComponent } from './completar-instalacion.component';
import { EvaluacionVisitaComponent } from './evaluacion-visita.component';
import type { EvaluacionTecnica } from './evaluacion-visita.component';
import {
  PropertyMapComponent,
  PropertyMapMode,
} from '../../shared/property-map/property-map.component';

export type TipoTarea = 'Instalación' | 'Visita Técnica';
export type EstadoTarea = 'Programada' | 'En Proceso' | 'Completada';

// Modelo visual compartido por visitas reales e instalaciones, sin crear una entidad Tarea.
export interface TareaTecnicaRow {
  id: number;
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
  tecnicos?: string[];
  encargado?: string;
  estado: EstadoTarea;
  ubicacionDisponible?: boolean;
  puedeVer?: boolean;
  puedeRealizarAcciones?: boolean;
  esResponsable?: boolean;
  soloLectura?: boolean;
  bloqueada?: boolean;
  evaluacion?: EvaluacionTecnica;
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

@Component({
  selector: 'app-tareas',
  imports: [CompletarInstalacionComponent, EvaluacionVisitaComponent, PropertyMapComponent],
  templateUrl: './tareas.component.html',
  styleUrl: './tareas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TareasComponent implements OnInit, OnDestroy {
  private readonly visitasService = inject(VisitasTecnicasService);
  private readonly tareasService = inject(TareasService);

  readonly tasks = signal<TareaTecnicaRow[]>([]);
  readonly isLoadingTasks = signal(false);
  readonly loadError = signal('');
  readonly searchTerm = signal('');
  readonly typeFilter = signal<'all' | TipoTarea>('all');
  readonly statusFilter = signal<'all' | EstadoTarea>('all');
  readonly installationToStart = signal<TareaTecnicaRow | null>(null);
  readonly installationToComplete = signal<TareaTecnicaRow | null>(null);
  readonly visitForEvaluation = signal<TareaTecnicaRow | null>(null);
  readonly visitForLocation = signal<TareaTecnicaRow | null>(null);
  readonly locationAddress = signal('');
  readonly locationReference = signal('');
  readonly locationObservations = signal('');
  readonly capturedLatitude = signal<number | null>(null);
  readonly capturedLongitude = signal<number | null>(null);
  readonly isCapturingLocation = signal(false);
  readonly geolocationMessage = signal('');
  readonly geolocationError = signal('');
  readonly facadePhoto = signal<File | null>(null);
  readonly facadePreviewUrl = signal<string | null>(null);
  readonly isSavingLocation = signal(false);
  readonly locationFormError = signal('');
  readonly actionMessage = signal('');
  readonly propertyMapMode = signal<PropertyMapMode | null>(null);
  readonly propertyMapCoordinates = signal<MapCoordinates | null>(null);
  readonly propertyMapTask = signal<TareaTecnicaRow | null>(null);
  readonly mapNavigationTarget = signal<MapNavigationTarget | null>(null);
  private readonly todayKey = this.toDateKey(new Date());
  private evaluationRequestId: number | null = null;
  private facadeObjectUrl: string | null = null;
  private geolocationRequestId = 0;
  private mapSelectionOrigin: 'gps' | 'manual' | null = null;

  /** Carga la proyección autorizada de visitas e instalaciones. */
  ngOnInit(): void {
    this.loadTasks();
  }

  ngOnDestroy(): void {
    this.revokeFacadePreview();
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
    if (task.tipo !== 'Instalación' || task.estado !== 'Programada' || task.bloqueada) {
      return;
    }
    this.installationToStart.set(task);
  }

  closeStartInstallation(): void {
    this.installationToStart.set(null);
  }

  // Tareas es una consulta: no simula transiciones que no fueron persistidas por el backend.
  confirmStartInstallation(): void {
    const selected = this.installationToStart();
    if (
      !selected ||
      selected.tipo !== 'Instalación' ||
      selected.estado !== 'Programada' ||
      selected.bloqueada
    ) {
      return;
    }
    this.loadError.set(
      'El inicio de instalaciones no se modifica desde Tareas; el estado mostrado sigue siendo el registrado.',
    );
    this.closeStartInstallation();
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

  openLocationRegistration(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Visita Técnica' ||
      task.id_visita === null ||
      task.id_ubicacion !== null ||
      !task.puedeRealizarAcciones
    ) {
      return;
    }
    this.locationAddress.set('');
    this.locationReference.set('');
    this.locationObservations.set('');
    this.clearCapturedCoordinates();
    this.facadePhoto.set(null);
    this.locationFormError.set('');
    this.revokeFacadePreview();
    this.visitForLocation.set(task);
  }

  closeLocationRegistration(): void {
    if (this.isSavingLocation()) {
      return;
    }
    this.visitForLocation.set(null);
    // Invalida callbacks del navegador que lleguen después de cerrar el modal.
    this.geolocationRequestId += 1;
    this.clearCapturedCoordinates();
    this.facadePhoto.set(null);
    this.locationFormError.set('');
    this.revokeFacadePreview();
  }

  onLocationTextChange(field: 'direccion' | 'referencia' | 'observaciones', event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = {
      direccion: this.locationAddress,
      referencia: this.locationReference,
      observaciones: this.locationObservations,
    }[field];
    target.set(input.value);
  }

  onFacadePhotoChange(event: Event): void {
    const input = event.target;
    const photo = input instanceof HTMLInputElement ? input.files?.item(0) : null;
    if (!photo) {
      return;
    }
    this.revokeFacadePreview();
    this.facadePhoto.set(photo);
    this.facadeObjectUrl = URL.createObjectURL(photo);
    this.facadePreviewUrl.set(this.facadeObjectUrl);
  }

  useCurrentLocation(): void {
    if (this.isCapturingLocation()) {
      return;
    }
    this.geolocationError.set('');
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
        // PostgreSQL conserva siete decimales; se ajusta solo esa precisión sin inventar valores.
        this.isCapturingLocation.set(false);
        this.openCoordinateSelection(
          {
            latitud: Number(position.coords.latitude.toFixed(7)),
            longitud: Number(position.coords.longitude.toFixed(7)),
          },
          'gps',
        );
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
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    );
  }

  selectLocationOnMap(): void {
    const latitude = this.capturedLatitude();
    const longitude = this.capturedLongitude();
    this.openCoordinateSelection(
      latitude !== null && longitude !== null ? { latitud: latitude, longitud: longitude } : null,
      'manual',
    );
  }

  confirmMapCoordinates(coordinates: MapCoordinates): void {
    this.capturedLatitude.set(coordinates.latitud);
    this.capturedLongitude.set(coordinates.longitud);
    this.geolocationMessage.set(
      this.mapSelectionOrigin === 'gps' ? 'Ubicación obtenida' : 'Ubicación seleccionada',
    );
    this.closePropertyMap();
  }

  openRegisteredLocationMap(task: TareaTecnicaRow): void {
    if (
      task.tipo !== 'Visita Técnica' ||
      task.id_ubicacion === null ||
      task.latitud === null ||
      task.latitud === undefined ||
      task.longitud === null ||
      task.longitud === undefined
    ) {
      return;
    }
    this.propertyMapTask.set(task);
    this.propertyMapCoordinates.set({ latitud: task.latitud, longitud: task.longitud });
    this.propertyMapMode.set('readonly');
  }

  /** Conserva el destino real para enlazarlo al futuro módulo Mapas sin navegar todavía. */
  prepareDirections(task: TareaTecnicaRow): void {
    if (task.id_ubicacion === null || !this.hasGeographicCoordinates(task)) {
      return;
    }
    this.mapNavigationTarget.set({
      id_ubicacion: task.id_ubicacion,
      numeroPropiedad: task.numeroPropiedad ?? null,
      latitud: task.latitud,
      longitud: task.longitud,
    });
    const destination =
      task.numeroPropiedad === null || task.numeroPropiedad === undefined
        ? 'la propiedad seleccionada'
        : `la Propiedad ${task.numeroPropiedad}`;
    this.actionMessage.set(
      `La navegación hacia ${destination} estará disponible desde Mapas.`,
    );
  }

  hasGeographicCoordinates(
    task: TareaTecnicaRow,
  ): task is TareaTecnicaRow & { latitud: number; longitud: number } {
    return (
      task.latitud !== null &&
      task.latitud !== undefined &&
      task.longitud !== null &&
      task.longitud !== undefined
    );
  }

  closePropertyMap(): void {
    this.propertyMapMode.set(null);
    this.propertyMapCoordinates.set(null);
    this.propertyMapTask.set(null);
    this.mapSelectionOrigin = null;
  }

  submitLocation(event: Event): void {
    event.preventDefault();
    const task = this.visitForLocation();
    const direccion = this.locationAddress().trim();
    const latitude = this.capturedLatitude();
    const longitude = this.capturedLongitude();
    if (!task || task.id_visita === null || this.isSavingLocation()) {
      return;
    }
    if (!direccion) {
      this.locationFormError.set('La dirección de la propiedad es obligatoria.');
      return;
    }

    this.locationFormError.set('');
    this.isSavingLocation.set(true);
    this.visitasService
      .registerFirstLocation(
        task.id_visita,
        {
          direccion,
          ...(this.locationReference().trim()
            ? { referencia: this.locationReference().trim() }
            : {}),
          ...(this.locationObservations().trim()
            ? { observaciones: this.locationObservations().trim() }
            : {}),
          ...(latitude !== null && longitude !== null
            ? { latitud: latitude, longitud: longitude }
            : {}),
        },
        this.facadePhoto() ?? undefined,
      )
      .pipe(finalize(() => this.isSavingLocation.set(false)))
      .subscribe({
        next: (location) => {
          // La respuesta atómica permite actualizar la tarjeta sin recargar el tablero.
          this.tasks.update((tasks) =>
            tasks.map((current) =>
              current.tipo === 'Visita Técnica' && current.id_visita === task.id_visita
                ? {
                    ...current,
                    id_ubicacion: location.id_ubicacion,
                    numeroPropiedad: location.numero_propiedad,
                    direccionPropiedad: location.direccion,
                    referenciaPropiedad: location.referencia,
                    fotoFachada: location.foto_fachada,
                    latitud: location.latitud,
                    longitud: location.longitud,
                    ubicacionDisponible: true,
                  }
                : current,
            ),
          );
          this.actionMessage.set(
            `Propiedad ${location.numero_propiedad} registrada correctamente.`,
          );
          this.isSavingLocation.set(false);
          this.closeLocationRegistration();
        },
        error: (error: unknown) => {
          this.locationFormError.set(
            getApiErrorMessage(error, 'No fue posible registrar la propiedad.'),
          );
        },
      });
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
  }

  /** Reemplaza la visita finalizada y cierra el modal sin alterar las instalaciones del tablero. */
  onVisitEvaluationSaved(visit: VisitaTecnica): void {
    this.replaceVisitTask(visit);
    this.closeVisitEvaluation();
  }

  // La finalización solo se habilita para instalaciones En Proceso que no estén bloqueadas.
  openCompleteInstallation(task: TareaTecnicaRow): void {
    if (task.tipo !== 'Instalación' || task.estado !== 'En Proceso' || task.bloqueada) {
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
      tecnicos:
        task.tipo === 'Instalación'
          ? task.tecnicos.map((technician) => technician.nombre)
          : undefined,
      encargado: task.tipo === 'Instalación' ? lead?.nombre : undefined,
      estado: task.estado,
      ubicacionDisponible: task.ubicacion_disponible,
      puedeVer: task.puede_ver,
      puedeRealizarAcciones: task.puede_realizar_acciones,
      esResponsable: task.es_responsable,
      bloqueada: task.bloqueada,
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

  private revokeFacadePreview(): void {
    if (this.facadeObjectUrl) {
      URL.revokeObjectURL(this.facadeObjectUrl);
      this.facadeObjectUrl = null;
    }
    this.facadePreviewUrl.set(null);
  }

  private clearCapturedCoordinates(): void {
    this.capturedLatitude.set(null);
    this.capturedLongitude.set(null);
    this.isCapturingLocation.set(false);
    this.geolocationMessage.set('');
    this.geolocationError.set('');
  }

  private openCoordinateSelection(
    coordinates: MapCoordinates | null,
    origin: 'gps' | 'manual',
  ): void {
    this.mapSelectionOrigin = origin;
    this.propertyMapCoordinates.set(coordinates);
    this.propertyMapTask.set(this.visitForLocation());
    this.propertyMapMode.set('select');
  }
}
