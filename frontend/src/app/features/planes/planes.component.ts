import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessage } from '../../core/utils/api-error';
import { AuthService } from '../../core/services/auth.service';
import { PlanesService } from '../../core/services/planes.service';
import { EstadoPlan, Plan, PlanCreate, PlanUpdate, TipoPlan } from '../../core/models/plan.models';

type PlanView = 'overview' | 'list';
type PlanStatusFilter = 'all' | 'active' | 'inactive';
type Notice = { title: string; message: string };

const STANDARD_SPEEDS = [
  '5 Mbps',
  '10 Mbps',
  '15 Mbps',
  '20 Mbps',
  '25 Mbps',
  '30 Mbps',
  '50 Mbps',
  '100 Mbps',
];

@Component({
  selector: 'app-planes',
  imports: [DecimalPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './planes.component.html',
  styleUrl: './planes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanesComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly planesService = inject(PlanesService);
  readonly auth = inject(AuthService);

  readonly view = signal<PlanView>('overview');
  readonly selectedType = signal<TipoPlan>('ESTANDAR');
  readonly plans = signal<Plan[]>([]);
  readonly searchTerm = signal('');
  readonly activeFilter = signal<PlanStatusFilter>('all');
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly isLoadingEdit = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);
  readonly isModalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly deleteConfirmation = signal<Plan | null>(null);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);
  readonly submitted = signal(false);
  readonly standardSpeeds = STANDARD_SPEEDS;
  readonly canManage = computed(() => this.auth.currentUser()?.rol.nombre === 'Administrador');
  readonly filteredPlans = computed(() => {
    const query = this.normalize(this.searchTerm());
    const filter = this.activeFilter();
    return this.plans().filter((plan) => {
      if (plan.tipo_plan !== this.selectedType()) {
        return false;
      }
      if (
        (filter === 'active' && plan.estado !== 'Activo') ||
        (filter === 'inactive' && plan.estado !== 'Inactivo')
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return this.normalize(`${plan.nombre} ${plan.velocidad} ${plan.estado}`).includes(query);
    });
  });
  readonly managementTitle = computed(() =>
    this.selectedType() === 'ESTANDAR' ? 'PLANES' : 'PLANES PERSONALIZADOS',
  );
  readonly managementDescription = computed(() =>
    this.selectedType() === 'ESTANDAR'
      ? 'Gestione los planes de internet disponibles para los clientes.'
      : 'Gestione planes especiales con velocidad y precio personalizados.',
  );

  readonly form = this.formBuilder.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    velocidad: ['', [Validators.required, Validators.maxLength(30)]],
    precio_mensual: [
      '',
      [Validators.required, Validators.min(0.01), Validators.pattern(/^\d+(\.\d{1,2})?$/)],
    ],
    estado: ['Activo' as EstadoPlan, [Validators.required]],
    descripcion: ['', [Validators.maxLength(2000)]],
  });

  openManagement(tipoPlan: TipoPlan): void {
    this.selectedType.set(tipoPlan);
    this.view.set('list');
    this.searchTerm.set('');
    this.activeFilter.set('all');
    this.loadPlans();
  }

  goToOverview(): void {
    this.view.set('overview');
    this.searchTerm.set('');
    this.activeFilter.set('all');
    this.errorMessage.set('');
  }

  loadPlans(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.planesService
      .getAll(this.selectedType())
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (plans) => this.plans.set(plans),
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los planes.'));
        },
      });
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  setFilter(filter: PlanStatusFilter): void {
    this.activeFilter.set(filter);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.activeFilter.set('all');
  }

  openCreate(): void {
    if (!this.canManage()) {
      return;
    }
    this.editingId.set(null);
    this.form.reset({
      nombre: '',
      velocidad: '',
      precio_mensual: '',
      estado: 'Activo',
      descripcion: '',
    });
    this.resetFormState();
    this.isModalOpen.set(true);
  }

  openEdit(plan: Plan): void {
    if (!this.canManage()) {
      return;
    }
    this.errorMessage.set('');
    this.isLoadingEdit.set(plan.id);
    this.planesService
      .getById(plan.id)
      .pipe(finalize(() => this.isLoadingEdit.set(null)))
      .subscribe({
        next: (currentPlan) => {
          this.editingId.set(currentPlan.id);
          this.selectedType.set(currentPlan.tipo_plan);
          this.form.reset({
            nombre: currentPlan.nombre,
            velocidad: currentPlan.velocidad,
            precio_mensual: currentPlan.precio_mensual.toFixed(2),
            estado: currentPlan.estado,
            descripcion: currentPlan.descripcion ?? '',
          });
          this.resetFormState();
          this.isModalOpen.set(true);
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar el plan.'));
        },
      });
  }

  closeModal(): void {
    if (!this.isSaving()) {
      this.isModalOpen.set(false);
    }
  }

  save(): void {
    this.errorMessage.set('');
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }

    const raw = this.form.getRawValue();
    const id = this.editingId();
    const precioMensual = Number(raw.precio_mensual);
    const request =
      id === null
        ? this.planesService.create({
            nombre: raw.nombre.trim(),
            velocidad: raw.velocidad.trim(),
            precio_mensual: precioMensual,
            tipo_plan: this.selectedType(),
            estado: raw.estado,
            descripcion: raw.descripcion.trim() || null,
          } satisfies PlanCreate)
        : this.planesService.update(id, {
            nombre: raw.nombre.trim(),
            velocidad: raw.velocidad.trim(),
            precio_mensual: precioMensual,
            estado: raw.estado,
            descripcion: raw.descripcion.trim() || null,
          } satisfies PlanUpdate);

    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (savedPlan) => {
        this.plans.update((plans) =>
          id === null
            ? [savedPlan, ...plans]
            : plans.map((plan) => (plan.id === savedPlan.id ? savedPlan : plan)),
        );
        this.isModalOpen.set(false);
        this.notice.set({
          title: id === null ? 'Plan creado correctamente' : 'Plan actualizado correctamente',
          message:
            id === null
              ? 'El plan se ha registrado con éxito en el sistema.'
              : 'Los cambios del plan se han guardado con éxito.',
        });
      },
      error: (error: unknown) => {
        this.errorMessage.set(
          getApiErrorMessage(
            error,
            id === null ? 'No se pudo guardar el plan.' : 'No se pudo actualizar el plan.',
          ),
        );
      },
    });
  }

  requestDelete(plan: Plan): void {
    if (this.canManage() && !this.deletingId()) {
      this.errorMessage.set('');
      this.notice.set(null);
      this.deleteConfirmation.set(plan);
    }
  }

  cancelDelete(): void {
    if (!this.deletingId()) {
      this.deleteConfirmation.set(null);
    }
  }

  confirmDelete(): void {
    const plan = this.deleteConfirmation();
    this.deleteConfirmation.set(null);
    if (!plan) {
      return;
    }

    this.deletingId.set(plan.id);
    this.planesService
      .delete(plan.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: () => {
          this.plans.update((plans) => plans.filter((item) => item.id !== plan.id));
          this.notice.set({
            title: 'Plan eliminado correctamente',
            message: 'El plan se ha eliminado permanentemente del sistema.',
          });
        },
        error: (error: unknown) => {
          this.errorMessage.set(
            getApiErrorMessage(
              error,
              'No se puede eliminar el plan porque está siendo utilizado por uno o más servicios.',
            ),
          );
        },
      });
  }

  clearNotice(): void {
    this.notice.set(null);
  }

  private resetFormState(): void {
    this.errorMessage.set('');
    this.submitted.set(false);
    this.form.markAsUntouched();
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
}
