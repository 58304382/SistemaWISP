import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  AsignacionPlan,
  AsignacionPlanPayload,
  ClienteAsignacionCatalogo,
  EstadoAsignacionPlan,
  PlanAsignacionCatalogo,
} from '../../models/asignacion-plan.models';
import { AsignacionesPlanService } from '../../services/asignaciones-plan.service';

type EstadoFiltro = 'Todos' | EstadoAsignacionPlan;
type Notice = { title: string; message: string };

@Component({
  selector: 'app-asignacion-planes',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './asignacion-planes.component.html',
  styleUrl: './asignacion-planes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsignacionPlanesComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly asignacionesService = inject(AsignacionesPlanService);

  readonly asignaciones = signal<AsignacionPlan[]>([]);
  readonly clientes = signal<ClienteAsignacionCatalogo[]>([]);
  readonly planes = signal<PlanAsignacionCatalogo[]>([]);
  readonly searchTerm = signal('');
  readonly estadoFiltro = signal<EstadoFiltro>('Todos');
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly processingId = signal<number | null>(null);
  readonly isFormOpen = signal(false);
  readonly editingAsignacion = signal<AsignacionPlan | null>(null);
  readonly selectedAsignacion = signal<AsignacionPlan | null>(null);
  readonly deleteConfirmation = signal<AsignacionPlan | null>(null);
  readonly selectedPrice = signal<number | null>(null);
  readonly clientSearch = signal('');
  readonly isClientDropdownOpen = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    id_cliente: [0, [Validators.required, Validators.min(1)]],
    id_plan: [0, [Validators.required, Validators.min(1)]],
    fecha_inicio: ['', Validators.required],
    estado: ['Activo' as EstadoAsignacionPlan, Validators.required],
  });

  /** Aplica búsqueda por cliente o plan y el filtro de estado sobre el listado cargado. */
  readonly filteredAsignaciones = computed(() => {
    const query = this.normalize(this.searchTerm());
    const estado = this.estadoFiltro();
    return this.asignaciones().filter((asignacion) => {
      const matchesState = estado === 'Todos' || asignacion.estado === estado;
      const matchesSearch =
        !query ||
        this.normalize(
          `${asignacion.cliente.nombres} ${asignacion.cliente.apellidos} ${asignacion.plan.nombre}`,
        ).includes(query);
      return matchesState && matchesSearch;
    });
  });

  /** Filtra el desplegable únicamente por nombres y apellidos, sin distinguir tildes. */
  readonly filteredClients = computed(() => {
    const query = this.normalize(this.clientSearch());
    return this.clientes()
      .filter((cliente) =>
        this.normalize(`${cliente.nombres} ${cliente.apellidos}`).includes(query),
      )
      .slice(0, 8);
  });

  ngOnInit(): void {
    this.loadData();
  }

  /** Carga asignaciones y selectores desde endpoints protegidos por el mismo módulo. */
  loadData(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    forkJoin({
      asignaciones: this.asignacionesService.getAll(),
      clientes: this.asignacionesService.getClientes(),
      planes: this.asignacionesService.getPlanes(),
    })
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: ({ asignaciones, clientes, planes }) => {
          this.asignaciones.set(asignaciones);
          this.clientes.set(clientes);
          this.planes.set(planes);
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible cargar las asignaciones de planes.'),
          ),
      });
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  onEstadoFilter(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.estadoFiltro.set(select.value as EstadoFiltro);
    }
  }

  /** Sincroniza el campo visual de precio con el plan activo seleccionado. */
  onPlanChange(): void {
    const plan = this.planes().find((item) => item.id === this.form.controls.id_plan.value);
    this.selectedPrice.set(plan ? Number(plan.precio_mensual) : null);
  }

  /** Al escribir invalida la selección anterior hasta elegir nuevamente un cliente. */
  onClientSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.clientSearch.set(input.value);
      this.form.controls.id_cliente.setValue(0);
      this.isClientDropdownOpen.set(true);
    }
  }

  openClientDropdown(): void {
    this.isClientDropdownOpen.set(true);
  }

  closeClientDropdown(): void {
    this.isClientDropdownOpen.set(false);
  }

  selectClient(cliente: ClienteAsignacionCatalogo): void {
    this.form.controls.id_cliente.setValue(cliente.id_cliente);
    this.clientSearch.set(this.clienteNombre(cliente));
    this.isClientDropdownOpen.set(false);
  }

  openCreate(): void {
    this.editingAsignacion.set(null);
    this.form.reset({
      id_cliente: 0,
      id_plan: 0,
      fecha_inicio: this.today(),
      estado: 'Activo',
    });
    this.clientSearch.set('');
    this.isClientDropdownOpen.set(false);
    this.selectedPrice.set(null);
    this.submitted.set(false);
    this.errorMessage.set('');
    this.isFormOpen.set(true);
  }

  /** Consulta el registro vigente antes de editarlo. */
  openEdit(asignacion: AsignacionPlan): void {
    if (this.processingId()) return;
    this.processingId.set(asignacion.id_asignacion);
    this.errorMessage.set('');
    this.asignacionesService
      .getById(asignacion.id_asignacion)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: (current) => {
          this.editingAsignacion.set(current);
          this.form.reset({
            id_cliente: current.id_cliente,
            id_plan: current.id_plan,
            fecha_inicio: current.fecha_inicio,
            estado: current.estado,
          });
          this.clientSearch.set(this.clienteNombre(current.cliente));
          this.isClientDropdownOpen.set(false);
          this.selectedPrice.set(Number(current.costo_mensual));
          this.submitted.set(false);
          this.isFormOpen.set(true);
        },
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar la asignación.')),
      });
  }

  /** Abre el detalle usando la versión actual entregada por FastAPI. */
  openDetails(asignacion: AsignacionPlan): void {
    if (this.processingId()) return;
    this.processingId.set(asignacion.id_asignacion);
    this.asignacionesService
      .getById(asignacion.id_asignacion)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: (current) => this.selectedAsignacion.set(current),
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar la asignación.')),
      });
  }

  closeForm(): void {
    if (!this.isSaving()) {
      this.isFormOpen.set(false);
      this.editingAsignacion.set(null);
      this.errorMessage.set('');
    }
  }

  requestDelete(asignacion: AsignacionPlan): void {
    if (this.processingId()) return;
    this.errorMessage.set('');
    this.deleteConfirmation.set(asignacion);
  }

  cancelDelete(): void {
    if (this.processingId()) return;
    this.deleteConfirmation.set(null);
    this.errorMessage.set('');
  }

  /** Elimina solo la asignación confirmada; FastAPI protege cualquier relación existente. */
  confirmDelete(): void {
    const asignacion = this.deleteConfirmation();
    if (!asignacion || this.processingId()) return;

    this.processingId.set(asignacion.id_asignacion);
    this.errorMessage.set('');
    this.asignacionesService
      .delete(asignacion.id_asignacion)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: () => {
          this.asignaciones.update((items) =>
            items.filter((item) => item.id_asignacion !== asignacion.id_asignacion),
          );
          this.deleteConfirmation.set(null);
          this.notice.set({
            title: 'Asignación eliminada',
            message: 'La asignación de plan se eliminó correctamente.',
          });
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible eliminar la asignación.'),
          ),
      });
  }

  /** Envía solo IDs, fecha y estado; el precio nunca se incluye en el payload. */
  saveAsignacion(): void {
    if (this.isSaving()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.selectedPrice() === null) {
      this.errorMessage.set('Complete Cliente, Plan de Internet, Fecha de inicio y Estado.');
      return;
    }

    const raw = this.form.getRawValue();
    const payload: AsignacionPlanPayload = {
      id_cliente: raw.id_cliente,
      id_plan: raw.id_plan,
      fecha_inicio: raw.fecha_inicio,
      estado: raw.estado,
    };
    const editing = this.editingAsignacion();
    const request = editing
      ? this.asignacionesService.update(editing.id_asignacion, payload)
      : this.asignacionesService.create(payload);

    this.isSaving.set(true);
    this.errorMessage.set('');
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (saved) => {
        this.asignaciones.update((items) =>
          editing
            ? items.map((item) => (item.id_asignacion === saved.id_asignacion ? saved : item))
            : [saved, ...items],
        );
        this.isFormOpen.set(false);
        this.editingAsignacion.set(null);
        this.notice.set({
          title: editing ? 'Asignación actualizada' : 'Asignación registrada',
          message: editing
            ? 'La asignación de plan se actualizó correctamente.'
            : 'El plan se asignó correctamente al cliente.',
        });
      },
      error: (error: unknown) =>
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible guardar la asignación.')),
    });
  }

  clienteNombre(cliente: ClienteAsignacionCatalogo): string {
    return `${cliente.nombres} ${cliente.apellidos}`.trim();
  }

  formattedSelectedPrice(): string {
    const price = this.selectedPrice();
    return price === null ? '' : `Q ${price.toFixed(2)}`;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private today(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }
}
