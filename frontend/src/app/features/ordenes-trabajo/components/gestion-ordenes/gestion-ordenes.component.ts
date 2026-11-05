// ==========================================
// COMPONENTE DE GESTIÓN DE ÓRDENES DE TRABAJO
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { finalize } from 'rxjs';

import { Cliente } from '../../../clientes/models/cliente.models';
import { ClientesService } from '../../../clientes/services/clientes.service';
import {
  CotizacionVista,
  cotizacionResponseAVista,
} from '../../../cotizaciones/models/cotizacion.models';
import { CotizacionesService } from '../../../cotizaciones/services/cotizaciones.service';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  EquipoOrdenInput,
  EstadoOrden,
  OrdenTrabajo,
  OrdenTrabajoCreate,
  OrdenTrabajoUpdate,
  TecnicoOrden,
  TipoTrabajo,
} from '../../models/orden-trabajo.models';
import { OrdenesTrabajoService } from '../../services/ordenes-trabajo.service';

type EquipoField =
  | 'tipo_equipo'
  | 'marca'
  | 'modelo'
  | 'problema_reportado'
  | 'accesorios_recibidos'
  | 'observaciones';

const EQUIPO_FIELDS: EquipoField[] = [
  'tipo_equipo',
  'marca',
  'modelo',
  'problema_reportado',
  'accesorios_recibidos',
  'observaciones',
];

@Component({
  selector: 'app-gestion-ordenes',
  templateUrl: './gestion-ordenes.component.html',
  styleUrl: './gestion-ordenes.component.css',
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GestionOrdenesComponent implements OnInit, OnDestroy {
  private readonly clientesService = inject(ClientesService);
  private readonly ordenesService = inject(OrdenesTrabajoService);
  private readonly cotizacionesService = inject(CotizacionesService);

  // ==========================================
  // ESTADO GENERAL DE LA PANTALLA
  // ==========================================
  readonly orders = signal<OrdenTrabajo[]>([]);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | EstadoOrden>('all');
  readonly isLoading = signal(false);
  readonly loadError = signal('');
  readonly actionMessage = signal('');
  readonly actionError = signal('');

  readonly filteredOrders = computed(() => {
    const query = this.normalize(this.searchTerm());
    const status = this.statusFilter();
    return this.orders().filter((orden) => {
      const matchesQuery = this.normalize(
        `${orden.nombre_cliente} ${orden.nombre_tecnico}`,
      ).includes(query);
      return matchesQuery && (status === 'all' || orden.estado === status);
    });
  });

  // ==========================================
  // MODALES Y OPERACIONES
  // ==========================================
  readonly isModalOpen = signal(false);
  readonly editingOrden = signal<OrdenTrabajo | null>(null);
  readonly viewedOrden = signal<OrdenTrabajo | null>(null);
  // Datos complementarios del detalle («Ver») que no vienen en el DTO de la orden:
  // el teléfono del cliente y la cotización vinculada a su evaluación de orden.
  readonly viewedClientPhone = signal<string | null>(null);
  readonly viewedCotizacion = signal<CotizacionVista | null>(null);
  readonly isViewLoading = signal(false);
  readonly viewError = signal('');
  readonly deleteConfirmation = signal<OrdenTrabajo | null>(null);
  readonly isSaving = signal(false);
  readonly deletingOrdenId = signal<number | null>(null);

  // ==========================================
  // CATALOGOS DEL FORMULARIO
  // ==========================================
  readonly clients = signal<Cliente[]>([]);
  readonly tipos = signal<TipoTrabajo[]>([]);
  readonly technicians = signal<TecnicoOrden[]>([]);
  readonly areCatalogsLoading = signal(false);
  readonly catalogError = signal('');
  readonly formError = signal('');

  // ==========================================
  // CAMPOS DEL FORMULARIO
  // ==========================================
  readonly selectedClientId = signal<number | null>(null);
  readonly selectedTipoId = signal<number | null>(null);
  readonly selectedTecnicoId = signal<number | null>(null);
  readonly titulo = signal('');
  readonly descripcion = signal('');
  readonly equipoForm = signal<Record<EquipoField, string>>({
    tipo_equipo: '',
    marca: '',
    modelo: '',
    problema_reportado: '',
    accesorios_recibidos: '',
    observaciones: '',
  });

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnDestroy(): void {
    // Sin recursos externos que liberar (URLs de objetos o timers).
  }

  // ==========================================
  // CARGA DE ÓRDENES
  // ==========================================
  private loadOrders(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.ordenesService
      .getAll()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (orders) => this.orders.set(orders),
        error: (error: unknown) => {
          this.loadError.set(getApiErrorMessage(error, 'No fue posible cargar las órdenes.'));
        },
      });
  }

  // ==========================================
  // APERTURA Y CIERRE DE MODALES
  // ==========================================
  openCreate(): void {
    this.resetForm();
    this.editingOrden.set(null);
    this.actionMessage.set('');
    this.actionError.set('');
    this.isModalOpen.set(true);
    this.loadFormCatalogs();
  }

  closeCreate(): void {
    if (this.isSaving()) {
      return;
    }
    this.isModalOpen.set(false);
    this.editingOrden.set(null);
  }

  openView(orden: OrdenTrabajo): void {
    // El listado devuelve el DTO completo; Ver se muestra siempre disponible.
    this.actionMessage.set('');
    this.actionError.set('');
    this.viewedClientPhone.set(null);
    this.viewedCotizacion.set(null);
    this.viewError.set('');
    this.viewedOrden.set(orden);
    this.loadViewDetails(orden);
  }

  closeView(): void {
    this.viewedOrden.set(null);
    this.viewedClientPhone.set(null);
    this.viewedCotizacion.set(null);
    this.viewError.set('');
  }

  // ==========================================
  // DETALLE «VER» COMPLEMENTARIO
  // ==========================================
  // El teléfono del cliente y la cotización de la orden se consultan al abrir el
  // detalle; cualquier fallo se informa sin bloquear los datos ya disponibles.
  private loadViewDetails(orden: OrdenTrabajo): void {
    this.isViewLoading.set(true);
    this.clientesService.getById(orden.id_cliente).subscribe({
      next: (cliente) => this.viewedClientPhone.set(cliente.telefono),
      error: () => this.viewedClientPhone.set(null),
    });
    const idEvaluacion = orden.evaluacion?.id_evaluacion ?? null;
    if (idEvaluacion === null) {
      this.isViewLoading.set(false);
      return;
    }
    this.cotizacionesService
      .list()
      .pipe(finalize(() => this.isViewLoading.set(false)))
      .subscribe({
        next: (cotizaciones) => {
          // La cotización de la orden se identifica por su evaluación de origen.
          const match = cotizaciones.find(
            (cotizacion) => cotizacion.id_evaluacion_orden === idEvaluacion,
          );
          this.viewedCotizacion.set(match ? cotizacionResponseAVista(match) : null);
        },
        error: (error: unknown) => {
          this.viewError.set(
            getApiErrorMessage(error, 'No fue posible cargar la cotización de la orden.'),
          );
        },
      });
  }

  /** Avance real de la reparación a partir de la evaluación y la finalización. */
  viewedProgress(orden: OrdenTrabajo): string {
    // La cotización COMPLETADA por pago no sustituye el estado técnico de la orden.
    if (orden.estado === 'Completada') {
      return 'Orden completada · trabajo finalizado';
    }
    if (orden.finalizacion) {
      return 'Entrega pendiente · orden En Proceso';
    }
    if (orden.estado === 'En Proceso') {
      return 'Reparación en ejecución';
    }
    if (orden.evaluacion) {
      return 'Evaluación registrada · pendiente de inicio';
    }
    return 'Pendiente de evaluación técnica';
  }

  openEdit(orden: OrdenTrabajo): void {
    // Sólo las órdenes Programadas son editables; FastAPI vuelve a validar al guardar.
    if (orden.estado !== 'Programada') {
      return;
    }
    this.actionMessage.set('');
    this.actionError.set('');
    this.resetForm();
    this.editingOrden.set(orden);
    this.selectedClientId.set(orden.id_cliente);
    this.selectedTipoId.set(orden.id_tipo_trabajo);
    this.selectedTecnicoId.set(orden.id_empleado);
    this.titulo.set(orden.titulo);
    this.descripcion.set(orden.descripcion);
    const equipo = orden.equipo[0];
    if (equipo) {
      this.equipoForm.set({
        tipo_equipo: equipo.tipo_equipo,
        marca: equipo.marca ?? '',
        modelo: equipo.modelo ?? '',
        problema_reportado: equipo.problema_reportado,
        accesorios_recibidos: equipo.accesorios_recibidos ?? '',
        observaciones: equipo.observaciones ?? '',
      });
    }
    this.isModalOpen.set(true);
    this.loadFormCatalogs();
  }

  requestDeleteOrden(orden: OrdenTrabajo): void {
    if (orden.estado === 'Programada' && this.deletingOrdenId() === null) {
      this.deleteConfirmation.set(orden);
    }
  }

  cancelDelete(): void {
    this.deleteConfirmation.set(null);
  }

  confirmDelete(): void {
    const orden = this.deleteConfirmation();
    this.deleteConfirmation.set(null);
    if (!orden) {
      return;
    }
    this.deleteOrden(orden);
  }

  private deleteOrden(orden: OrdenTrabajo): void {
    this.actionMessage.set('');
    this.actionError.set('');
    this.deletingOrdenId.set(orden.id_orden);
    this.ordenesService
      .delete(orden.id_orden)
      .pipe(finalize(() => this.deletingOrdenId.set(null)))
      .subscribe({
        next: () => {
          this.orders.update((orders) =>
            orders.filter((current) => current.id_orden !== orden.id_orden),
          );
          this.actionMessage.set(`La orden ID ${orden.id_orden} fue eliminada correctamente.`);
        },
        error: (error: unknown) =>
          this.actionError.set(getApiErrorMessage(error, 'No fue posible eliminar la orden.')),
      });
  }

  // ==========================================
  // BUSQUEDA Y FILTROS
  // ==========================================
  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  onFilterChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.statusFilter.set(select.value as 'all' | EstadoOrden);
    }
  }

  // ==========================================
  // MANEJO DEL FORMULARIO
  // ==========================================
  onClienteChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedClientId.set(this.selectedId(select.value));
    }
  }

  onTipoChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedTipoId.set(this.selectedId(select.value));
    }
  }

  onTecnicoChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedTecnicoId.set(this.selectedId(select.value));
    }
  }

  onTextChange(field: 'titulo' | 'descripcion', event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = {
      titulo: this.titulo,
      descripcion: this.descripcion,
    }[field];
    target.set(input.value);
  }

  onEquipoChange(field: EquipoField, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    this.equipoForm.update((form) => ({ ...form, [field]: input.value }));
  }

  submitOrden(event: Event): void {
    event.preventDefault();
    if (this.isSaving()) {
      return;
    }
    const payload = this.buildCreatePayload();
    if (!payload) {
      return;
    }
    const editing = this.editingOrden();
    // Al editar se envía explícitamente el equipo (vacío cuando el usuario lo limpió)
    // para que FastAPI reemplace el conjunto completo asociado a la orden.
    if (editing) {
      payload.equipo = payload.equipo ?? [];
    }
    const request = editing
      ? this.ordenesService.update(editing.id_orden, payload satisfies OrdenTrabajoUpdate)
      : this.ordenesService.create(payload);
    this.formError.set('');
    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (orden) => {
        if (editing) {
          this.replaceOrden(orden);
        } else {
          this.orders.update((orders) => [orden, ...orders]);
        }
        this.isModalOpen.set(false);
        this.editingOrden.set(null);
        this.resetForm();
        this.actionMessage.set(
          `La orden ID ${orden.id_orden} fue ${editing ? 'actualizada' : 'creada'} correctamente.`,
        );
      },
      error: (error: unknown) => {
        this.formError.set(
          getApiErrorMessage(
            error,
            `No fue posible ${editing ? 'actualizar' : 'crear'} la orden de trabajo.`,
          ),
        );
      },
    });
  }

  private buildCreatePayload(): OrdenTrabajoCreate | null {
    const idCliente = this.selectedClientId();
    const idTipo = this.selectedTipoId();
    const idTecnico = this.selectedTecnicoId();
    const titulo = this.titulo().trim();
    const descripcion = this.descripcion().trim();
    if (idCliente === null || idTipo === null || idTecnico === null || !titulo || !descripcion) {
      this.formError.set('Completa el cliente, tipo de trabajo, técnico, título y descripción.');
      return null;
    }

    const equipo = this.buildEquipo();
    return {
      id_cliente: idCliente,
      id_tipo_trabajo: idTipo,
      id_empleado: idTecnico,
      titulo,
      descripcion,
      // La fecha estimada no se captura en este formulario; se conserva en edición
      // porque omitir el campo mantiene el valor persistido en el backend.
      ...(equipo ? { equipo: [equipo] } : {}),
    };
  }

  private buildEquipo(): EquipoOrdenInput | null {
    const form = this.equipoForm();
    const isEmpty = EQUIPO_FIELDS.every((field) => !form[field].trim());
    if (isEmpty) {
      return null;
    }
    const tipoEquipo = form.tipo_equipo.trim();
    const problemaReportado = form.problema_reportado.trim();
    if (!tipoEquipo || !problemaReportado) {
      this.formError.set('Si registras un equipo, especifica su tipo y el problema reportado.');
      return null;
    }
    // El equipo se reemplaza por completo al editar; se conservan los valores de
    // columnas que este formulario no edita (número de serie y estado de recepción).
    const equipoPrevio = this.editingOrden()?.equipo[0];
    return {
      tipo_equipo: tipoEquipo,
      problema_reportado: problemaReportado,
      ...this.optionalEquipmentField('marca'),
      ...this.optionalEquipmentField('modelo'),
      ...this.optionalEquipmentField('accesorios_recibidos'),
      ...this.optionalEquipmentField('observaciones'),
      ...(equipoPrevio?.numero_serie ? { numero_serie: equipoPrevio.numero_serie } : {}),
      ...(equipoPrevio?.estado_recepcion
        ? { estado_recepcion: equipoPrevio.estado_recepcion }
        : {}),
    };
  }

  private optionalEquipmentField(field: EquipoField): Record<string, string> {
    const value = this.equipoForm()[field]?.trim();
    return value ? { [field]: value } : {};
  }

  // ==========================================
  // CATALOGOS DEL FORMULARIO
  // ==========================================
  private loadFormCatalogs(): void {
    this.catalogError.set('');
    this.areCatalogsLoading.set(true);
    this.clientesService.getAll().pipe(finalize(() => this.areCatalogsLoading.set(false))).subscribe({
      next: (clients) => this.clients.set(clients.filter((client) => client.estado === 'Activo')),
      error: (error: unknown) => this.setCatalogError(error, 'los clientes'),
    });
    this.ordenesService.getTiposTrabajo().subscribe({
      next: (tipos) => this.tipos.set(tipos),
      error: (error: unknown) => this.setCatalogError(error, 'los tipos de trabajo'),
    });
    this.ordenesService.getTecnicos().subscribe({
      next: (tecnics) => this.technicians.set(tecnics),
      error: (error: unknown) => this.setCatalogError(error, 'los técnicos'),
    });
  }

  private setCatalogError(error: unknown, catalog: string): void {
    this.catalogError.set(getApiErrorMessage(error, `No fue posible cargar ${catalog}.`));
  }

  private resetForm(): void {
    this.selectedClientId.set(null);
    this.selectedTipoId.set(null);
    this.selectedTecnicoId.set(null);
    this.titulo.set('');
    this.descripcion.set('');
    this.equipoForm.set({
      tipo_equipo: '',
      marca: '',
      modelo: '',
      problema_reportado: '',
      accesorios_recibidos: '',
      observaciones: '',
    });
    this.formError.set('');
  }

  private replaceOrden(updated: OrdenTrabajo): void {
    this.orders.update((orders) =>
      orders.map((orden) => (orden.id_orden === updated.id_orden ? updated : orden)),
    );
  }

  technicianName(technician: TecnicoOrden): string {
    return `${technician.nombres} ${technician.apellidos}`.trim();
  }

  clientFullName(client: Cliente): string {
    return `${client.nombres} ${client.apellidos}`.trim();
  }

  private selectedId(value: string): number | null {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
