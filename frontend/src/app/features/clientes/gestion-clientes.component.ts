// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { getApiErrorMessage } from '../../core/utils/api-error';
import {
  Cliente,
  ClienteCreate,
  ClienteUpdate,
  EstadoCliente,
  Departamento,
  Municipio,
} from '../../core/models/cliente.models';
import { ClientesService } from '../../core/services/clientes.service';

// ==========================================
// TIPOS Y AVISOS DE LA VISTA
// ==========================================
type ClientFilter = 'all' | 'active' | 'inactive';
type Notice = { title: string; message: string };

// ==========================================
// COMPONENTE DE GESTION DE CLIENTES
// ==========================================
@Component({
  selector: 'app-gestion-clientes',
  imports: [ReactiveFormsModule],
  templateUrl: './gestion-clientes.component.html',
  styleUrl: './gestion-clientes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GestionClientesComponent implements OnInit {
  // ==========================================
  // DEPENDENCIAS Y ESTADO DEL COMPONENTE
  // ==========================================
  private readonly formBuilder = inject(FormBuilder);
  private readonly clientesService = inject(ClientesService);

  readonly clients = signal<Cliente[]>([]);
  readonly departamentos = signal<Departamento[]>([]);
  readonly municipios = signal<Municipio[]>([]);
  readonly searchTerm = signal('');
  readonly activeFilter = signal<ClientFilter>('all');
  readonly isLoading = signal(true);
  readonly isLoadingMunicipios = signal(false);
  readonly isSaving = signal(false);
  readonly isLoadingEdit = signal<number | null>(null);
  readonly isDeleting = signal<number | null>(null);
  readonly isModalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly deleteConfirmation = signal<Cliente | null>(null);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);
  readonly submitted = signal(false);

  // ==========================================
  // FORMULARIO DE CLIENTE
  // ==========================================
  readonly form = this.formBuilder.nonNullable.group({
    nombres: ['', [Validators.required, Validators.maxLength(150)]],
    apellidos: ['', [Validators.required, Validators.maxLength(150)]],
    dpi: ['', [Validators.required, Validators.maxLength(30)]],
    telefono: ['', [Validators.required, Validators.maxLength(30)]],
    correo: ['', [Validators.email, Validators.maxLength(254)]],
    id_departamento: [0, [Validators.required, Validators.min(1)]],
    id_municipio: [0, [Validators.required, Validators.min(1)]],
    direccion: ['', [Validators.required, Validators.maxLength(300)]],
    estado: ['Activo' as EstadoCliente, Validators.required],
  });

  // ==========================================
  // BUSQUEDA Y FILTROS
  // ==========================================
  readonly filteredClients = computed(() => {
    const query = this.normalize(this.searchTerm());
    const filter = this.activeFilter();

    return this.clients().filter((client) => {
      const matchesStatus =
        filter === 'all' ||
        (filter === 'active' && client.estado === 'Activo') ||
        (filter === 'inactive' && client.estado === 'Inactivo');
      if (!matchesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }
      return this.normalize(
        [client.nombres, client.apellidos, client.dpi ?? '', client.telefono].join(' '),
      ).includes(query);
    });
  });

  // ==========================================
  // CARGA INICIAL DE CLIENTES Y CATALOGOS
  // ==========================================
  ngOnInit(): void {
    this.form.controls.id_municipio.disable();
    this.loadDepartments();
    this.loadClients();
  }

  loadDepartments(): void {
    this.clientesService.getDepartamentos().subscribe({
      next: (departamentos) => this.departamentos.set(departamentos),
      error: (error: unknown) => {
        this.errorMessage.set(
          getApiErrorMessage(error, 'No fue posible cargar los departamentos.'),
        );
      },
    });
  }

  loadClients(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.clientesService
      .getAll()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (clients) => this.clients.set(clients),
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los clientes.'));
        },
      });
  }

  // ==========================================
  // DEPARTAMENTOS Y MUNICIPIOS
  // ==========================================
  onDepartmentChange(): void {
    // ngValue conserva el identificador numerico en el control reactivo.
    this.loadMunicipios(this.form.controls.id_departamento.value);
  }

  loadMunicipios(idDepartamento: number, selectedId = 0): void {
    this.municipios.set([]);
    this.form.controls.id_municipio.reset(0);
    this.form.controls.id_municipio.disable();
    if (!idDepartamento) {
      return;
    }

    this.isLoadingMunicipios.set(true);
    this.clientesService
      .getMunicipios(idDepartamento)
      .pipe(finalize(() => this.isLoadingMunicipios.set(false)))
      .subscribe({
        next: (municipios) => {
          this.municipios.set(municipios);
          this.form.controls.id_municipio.enable();
          this.form.controls.id_municipio.setValue(selectedId);
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los municipios.'));
        },
      });
  }

  // ==========================================
  // ESTADOS, BUSQUEDA Y FILTROS
  // ==========================================
  setFilter(filter: ClientFilter): void {
    this.activeFilter.set(filter);
  }

  onSearch(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.searchTerm.set(target.value);
    }
  }

onFilterChange(event: Event): void {
  const target = event.target;

  if (target instanceof HTMLSelectElement) {
    this.setFilter(target.value as ClientFilter);
  }
}

  clearFilters(): void {
    this.searchTerm.set('');
    this.activeFilter.set('all');
  }

  // ==========================================
  // CREAR CLIENTE
  // ==========================================
  openCreate(): void {
    if (!this.departamentos().length) {
      this.loadDepartments();
    }
    this.editingId.set(null);
    this.resetForm();
    this.isModalOpen.set(true);
  }

  // ==========================================
  // EDITAR CLIENTE
  // ==========================================
  openEdit(client: Cliente): void {
    this.errorMessage.set('');
    this.isLoadingEdit.set(client.id_cliente);
    this.clientesService
      .getById(client.id_cliente)
      .pipe(finalize(() => this.isLoadingEdit.set(null)))
      .subscribe({
        next: (currentClient) => {
          this.editingId.set(currentClient.id_cliente);
          this.form.reset({
            nombres: currentClient.nombres,
            apellidos: currentClient.apellidos,
            dpi: currentClient.dpi ?? '',
            telefono: currentClient.telefono,
            correo: currentClient.correo ?? '',
            id_departamento: currentClient.municipio.id_departamento,
            id_municipio: 0,
            direccion: currentClient.direccion,
            estado: currentClient.estado,
          });
          this.loadMunicipios(currentClient.municipio.id_departamento, currentClient.id_municipio);
          this.resetFormState();
          this.isModalOpen.set(true);
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar el cliente.'));
        },
      });
  }

  save(): void {
    this.errorMessage.set('');
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    if (!raw.id_municipio) {
      this.errorMessage.set('Selecciona un municipio.');
      return;
    }
    if (this.form.invalid) {
      return;
    }

    const id = this.editingId();
    const commonData = {
      id_municipio: raw.id_municipio,
      nombres: raw.nombres.trim(),
      apellidos: raw.apellidos.trim(),
      dpi: raw.dpi.trim(),
      telefono: raw.telefono.trim(),
      correo: this.optionalValue(raw.correo),
      direccion: raw.direccion.trim(),
    };
    const request =
      id === null
        ? this.clientesService.create({ ...commonData, estado: 'Activo' } satisfies ClienteCreate)
        : this.clientesService.update(id, {
            ...commonData,
            estado: raw.estado,
          } satisfies ClienteUpdate);

    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (savedClient) => {
        this.clients.update((clients) =>
          id === null
            ? [savedClient, ...clients]
            : clients.map((client) =>
                client.id_cliente === savedClient.id_cliente ? savedClient : client,
              ),
        );
        this.isModalOpen.set(false);
        this.notice.set({
          title: id === null ? 'Cliente creado correctamente' : 'Cliente actualizado correctamente',
          message:
            id === null
              ? 'La información del cliente se ha registrado con éxito.'
              : 'Los cambios del cliente se han guardado con éxito.',
        });
      },
      error: (error: unknown) => {
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible guardar el cliente.'));
      },
    });
  }

  // ==========================================
  // ELIMINAR CLIENTE MEDIANTE BAJA LOGICA
  // ==========================================
  requestDelete(client: Cliente): void {
    this.deleteConfirmation.set(client);
  }

  cancelDelete(): void {
    this.deleteConfirmation.set(null);
  }

  confirmDelete(): void {
    const client = this.deleteConfirmation();
    this.deleteConfirmation.set(null);
    if (!client) {
      return;
    }

    this.isDeleting.set(client.id_cliente);
    this.clientesService
      .delete(client.id_cliente)
      .pipe(finalize(() => this.isDeleting.set(null)))
      .subscribe({
        next: (updatedClient) => {
          this.clients.update((clients) =>
            clients.map((item) =>
              item.id_cliente === updatedClient.id_cliente ? updatedClient : item,
            ),
          );
          this.notice.set({
            title: 'Cliente eliminado correctamente',
            message: 'El cliente quedó inactivo y se conservó su registro histórico.',
          });
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible eliminar el cliente.'));
        },
      });
  }

  // ==========================================
  // MODAL Y VALIDACIONES
  // ==========================================
  closeModal(): void {
    if (!this.isSaving()) {
      this.isModalOpen.set(false);
    }
  }

  clearNotice(): void {
    this.notice.set(null);
  }

  hasError(controlName: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && (control.touched || this.submitted());
  }

  private resetForm(): void {
    this.form.reset({
      nombres: '',
      apellidos: '',
      dpi: '',
      telefono: '',
      correo: '',
      id_departamento: 0,
      id_municipio: 0,
      direccion: '',
      estado: 'Activo',
    });
    this.municipios.set([]);
    this.form.controls.id_municipio.disable();
    this.resetFormState();
  }

  private resetFormState(): void {
    this.errorMessage.set('');
    this.submitted.set(false);
  }

  private optionalValue(value: string): string | null {
    const normalized = value.trim();
    return normalized ? normalized : null;
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
