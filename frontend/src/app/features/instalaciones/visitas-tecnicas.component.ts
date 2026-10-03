import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { finalize } from 'rxjs';

import { API_BASE_URL } from '../../core/config/api.config';
import { Cliente } from '../../core/models/cliente.models';
import { UbicacionCliente } from '../../core/models/ubicacion-cliente.models';
import {
  EstadoVisitaTecnica,
  TecnicoVisita,
  TipoInstalacion,
  VisitaTecnica,
  VisitaTecnicaCreate,
  VisitaTecnicaUpdate,
} from '../../core/models/visita-tecnica.models';
import { ClientesService } from '../../core/services/clientes.service';
import { UbicacionesClienteService } from '../../core/services/ubicaciones-cliente.service';
import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { getApiErrorMessage } from '../../core/utils/api-error';

@Component({
  selector: 'app-visitas-tecnicas',
  templateUrl: './visitas-tecnicas.component.html',
  styleUrl: './visitas-tecnicas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisitasTecnicasComponent implements OnInit, OnDestroy {
  private readonly clientesService = inject(ClientesService);
  private readonly ubicacionesService = inject(UbicacionesClienteService);
  private readonly visitasService = inject(VisitasTecnicasService);

  readonly visits = signal<VisitaTecnica[]>([]);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | EstadoVisitaTecnica>('all');
  readonly isLoading = signal(false);
  readonly loadError = signal('');
  readonly actionMessage = signal('');
  readonly actionError = signal('');
  readonly isModalOpen = signal(false);
  readonly editingVisit = signal<VisitaTecnica | null>(null);
  readonly viewedVisit = signal<VisitaTecnica | null>(null);
  readonly deleteConfirmation = signal<VisitaTecnica | null>(null);
  readonly isSaving = signal(false);
  readonly deletingVisitId = signal<number | null>(null);
  readonly clients = signal<Cliente[]>([]);
  readonly technicians = signal<TecnicoVisita[]>([]);
  readonly areTechniciansLoading = signal(false);
  readonly installationTypes = signal<TipoInstalacion[]>([]);
  readonly clientSearch = signal('');
  readonly selectedClient = signal<Cliente | null>(null);
  readonly isClientDropdownOpen = signal(false);
  readonly clientLocations = signal<UbicacionCliente[]>([]);
  readonly selectedLocationId = signal<number | null>(null);
  readonly areLocationsLoading = signal(false);
  readonly locationsError = signal('');
  readonly selectedTechnicianId = signal<number | null>(null);
  readonly selectedTypeId = signal<number | null>(null);
  readonly scheduledDate = signal('');
  readonly scheduledTime = signal('');
  readonly visitReason = signal('');
  readonly instructions = signal('');
  readonly observations = signal('');
  readonly referencePhoto = signal<File | null>(null);
  readonly referencePhotoUrl = signal<string | null>(null);
  readonly catalogError = signal('');
  readonly formError = signal('');
  private referencePhotoObjectUrl: string | null = null;

  readonly filteredVisits = computed(() => {
    const query = this.normalize(this.searchTerm());
    const status = this.statusFilter();
    return this.visits().filter((visit) => {
      const matchesQuery = this.normalize(
        `${visit.nombre_cliente} ${visit.nombre_tecnico}`,
      ).includes(query);
      return matchesQuery && (status === 'all' || visit.estado === status);
    });
  });

  readonly selectedClientId = computed(() => this.selectedClient()?.id_cliente ?? null);
  readonly filteredClients = computed(() => {
    const query = this.normalize(this.clientSearch());
    if (!query) {
      return [];
    }
    return this.clients().filter((client) =>
      this.normalize(
        `${client.id_cliente} ${client.nombres} ${client.apellidos} ${client.dpi ?? ''} ${client.telefono}`,
      ).includes(query),
    );
  });

  ngOnInit(): void {
    this.loadVisits();
  }

  ngOnDestroy(): void {
    this.revokePhotoUrl();
  }

  openCreate(): void {
    this.resetForm();
    this.editingVisit.set(null);
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
    this.editingVisit.set(null);
    this.revokePhotoUrl();
  }

  openView(visit: VisitaTecnica): void {
    this.actionMessage.set('');
    this.actionError.set('');
    this.visitasService.getById(visit.id_visita).subscribe({
      next: (currentVisit) => this.viewedVisit.set(currentVisit),
      error: (error: unknown) =>
        this.actionError.set(getApiErrorMessage(error, 'No fue posible consultar la visita.')),
    });
  }

  closeView(): void {
    this.viewedVisit.set(null);
  }

  openEdit(visit: VisitaTecnica): void {
    // La comprobación visual evita abrir el formulario; FastAPI vuelve a validar el estado al guardar.
    if (visit.estado !== 'Programada') {
      return;
    }
    this.actionMessage.set('');
    this.actionError.set('');
    this.visitasService.getById(visit.id_visita).subscribe({
      next: (currentVisit) => {
        if (currentVisit.estado !== 'Programada') {
          this.replaceVisit(currentVisit);
          this.actionError.set('Solo las visitas Programadas pueden editarse.');
          return;
        }
        this.resetForm();
        this.editingVisit.set(currentVisit);
        this.selectedTechnicianId.set(currentVisit.id_empleado);
        this.selectedTypeId.set(currentVisit.id_tipo_instalacion);
        this.scheduledDate.set(currentVisit.fecha_programada);
        this.scheduledTime.set(currentVisit.hora_programada.slice(0, 5));
        this.visitReason.set(currentVisit.motivo_visita);
        this.instructions.set(currentVisit.indicaciones ?? '');
        this.observations.set(currentVisit.observaciones ?? '');
        this.isModalOpen.set(true);
        this.loadFormCatalogs(currentVisit.id_cliente, currentVisit.id_ubicacion);
      },
      error: (error: unknown) =>
        this.actionError.set(getApiErrorMessage(error, 'No fue posible cargar la visita.')),
    });
  }

  requestDeleteVisit(visit: VisitaTecnica): void {
    if (visit.estado === 'Programada' && this.deletingVisitId() === null) {
      this.deleteConfirmation.set(visit);
    }
  }

  cancelDelete(): void {
    this.deleteConfirmation.set(null);
  }

  confirmDelete(): void {
    const visit = this.deleteConfirmation();
    this.deleteConfirmation.set(null);
    if (!visit) {
      return;
    }
    this.deleteVisit(visit);
  }

  private deleteVisit(visit: VisitaTecnica): void {
    // FastAPI conserva la autoridad ante cambios de estado o relaciones protegidas.
    this.actionMessage.set('');
    this.actionError.set('');
    this.deletingVisitId.set(visit.id_visita);
    this.visitasService
      .deleteById(visit.id_visita)
      .pipe(finalize(() => this.deletingVisitId.set(null)))
      .subscribe({
        next: () => {
          this.visits.update((visits) =>
            visits.filter((currentVisit) => currentVisit.id_visita !== visit.id_visita),
          );
          this.actionMessage.set(`La visita ID ${visit.id_visita} fue eliminada correctamente.`);
        },
        error: (error: unknown) =>
          this.actionError.set(getApiErrorMessage(error, 'No fue posible eliminar la visita.')),
      });
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  onFilterChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.statusFilter.set(select.value as 'all' | EstadoVisitaTecnica);
    }
  }

  // La búsqueda conserva el ID de cliente únicamente tras elegir un resultado real.
  onClientSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.clientSearch.set(input.value);
      this.selectedClient.set(null);
      this.clearLocationSelection();
      this.isClientDropdownOpen.set(true);
    }
  }

  openClientDropdown(): void {
    if (this.clientSearch().trim()) {
      this.isClientDropdownOpen.set(true);
    }
  }

  closeClientDropdown(): void {
    this.isClientDropdownOpen.set(false);
  }

  selectClient(client: Cliente, preferredLocationId: number | null = null): void {
    this.selectedClient.set(client);
    this.clientSearch.set(this.clientName(client));
    this.isClientDropdownOpen.set(false);
    // Cambiar de cliente invalida inmediatamente cualquier propiedad anterior.
    this.clearLocationSelection();
    this.loadClientLocations(client.id_cliente, preferredLocationId);
  }

  changeClient(): void {
    this.selectedClient.set(null);
    this.clientSearch.set('');
    this.isClientDropdownOpen.set(false);
    this.clearLocationSelection();
  }

  onLocationChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedLocationId.set(this.selectedId(select.value));
    }
  }

  onTechnicianChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedTechnicianId.set(this.selectedId(select.value));
    }
  }

  onTypeChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.selectedTypeId.set(this.selectedId(select.value));
    }
  }

  onTextChange(
    field: 'date' | 'time' | 'reason' | 'instructions' | 'observations',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = {
      date: this.scheduledDate,
      time: this.scheduledTime,
      reason: this.visitReason,
      instructions: this.instructions,
      observations: this.observations,
    }[field];
    target.set(input.value);
  }

  onPhotoChange(event: Event): void {
    const input = event.target;
    const photo = input instanceof HTMLInputElement ? input.files?.item(0) : null;
    if (!photo) {
      return;
    }
    // La URL blob solo sirve para preview; el File original se conserva para FormData.
    this.revokePhotoUrl();
    this.referencePhoto.set(photo);
    this.referencePhotoObjectUrl = URL.createObjectURL(photo);
    this.referencePhotoUrl.set(this.referencePhotoObjectUrl);
  }

  removeReferencePhoto(input: HTMLInputElement): void {
    input.value = '';
    this.referencePhoto.set(null);
    this.revokePhotoUrl();
  }

  submitVisit(event: Event): void {
    event.preventDefault();
    if (this.isSaving()) {
      return;
    }

    const data = this.buildCreatePayload();
    if (!data) {
      return;
    }

    const editingVisit = this.editingVisit();
    const request = editingVisit
      ? this.visitasService.update(editingVisit.id_visita, {
          ...data,
          // En edición, null permite retirar textos opcionales ya persistidos.
          indicaciones: this.instructions().trim() || null,
          observaciones: this.observations().trim() || null,
        } satisfies VisitaTecnicaUpdate)
      : this.visitasService.create(data, this.referencePhoto() ?? undefined);
    this.formError.set('');
    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (visit) => {
        if (editingVisit) {
          this.replaceVisit(visit);
        } else {
          this.visits.update((visits) => [visit, ...visits]);
        }
        this.isModalOpen.set(false);
        this.editingVisit.set(null);
        this.resetForm();
        this.actionMessage.set(
          `La visita ID ${visit.id_visita} fue ${editingVisit ? 'actualizada' : 'creada'} correctamente.`,
        );
      },
      error: (error: unknown) => {
        this.formError.set(
          getApiErrorMessage(
            error,
            `No fue posible ${editingVisit ? 'actualizar' : 'crear'} la visita técnica.`,
          ),
        );
      },
    });
  }

  technicianName(technician: TecnicoVisita): string {
    return `${technician.nombres} ${technician.apellidos}`.trim();
  }

  clientName(client: Cliente): string {
    return `${client.nombres} ${client.apellidos}`.trim();
  }

  propertyLabel(location: UbicacionCliente): string {
    const reference = location.direccion || location.referencia || 'Sin dirección registrada';
    return `Propiedad ${location.numero_propiedad} — ${reference}`;
  }

  photoUrl(path: string | null): string | null {
    if (!path) {
      return null;
    }
    return /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
  }

  private loadVisits(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    this.visitasService
      .getAll()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (visits) => this.visits.set(visits),
        error: (error: unknown) => {
          this.loadError.set(getApiErrorMessage(error, 'No fue posible cargar las visitas.'));
        },
      });
  }

  private loadFormCatalogs(
    selectedClientId?: number,
    selectedLocationId: number | null = null,
  ): void {
    this.catalogError.set('');
    this.clientesService.getAll().subscribe({
      next: (clients) => {
        const activeClients = clients.filter((client) => client.estado === 'Activo');
        this.clients.set(activeClients);
        if (selectedClientId !== undefined) {
          const selectedClient = activeClients.find(
            (client) => client.id_cliente === selectedClientId,
          );
          if (selectedClient) {
            this.selectClient(selectedClient, selectedLocationId);
          } else {
            this.formError.set('El cliente actual no está disponible para editar la visita.');
          }
        }
      },
      error: (error: unknown) => this.setCatalogError(error, 'los clientes'),
    });
    // Estos catálogos provienen de rutas específicas: no se infieren IDs desde nombres.
    this.visitasService.getTiposInstalacion().subscribe({
      next: (types) => this.installationTypes.set(types),
      error: (error: unknown) => this.setCatalogError(error, 'los tipos de instalación'),
    });
    this.areTechniciansLoading.set(true);
    this.visitasService
      .getTecnicos()
      .pipe(finalize(() => this.areTechniciansLoading.set(false)))
      .subscribe({
        next: (technicians) => this.technicians.set(technicians),
        error: (error: unknown) => this.setCatalogError(error, 'los técnicos'),
      });
  }

  private buildCreatePayload(): VisitaTecnicaCreate | null {
    const idCliente = this.selectedClientId();
    const idEmpleado = this.selectedTechnicianId();
    const idTipoInstalacion = this.selectedTypeId();
    const reason = this.visitReason().trim();
    if (
      idCliente === null ||
      idEmpleado === null ||
      idTipoInstalacion === null ||
      !this.scheduledDate() ||
      !this.scheduledTime() ||
      !reason
    ) {
      this.formError.set('Completa el cliente, tipo, técnico, fecha, hora y motivo de visita.');
      return null;
    }

    return {
      id_cliente: idCliente,
      id_ubicacion: this.selectedLocationId(),
      id_empleado: idEmpleado,
      id_tipo_instalacion: idTipoInstalacion,
      fecha_programada: this.scheduledDate(),
      hora_programada: this.scheduledTime(),
      motivo_visita: reason,
      ...(this.instructions().trim() ? { indicaciones: this.instructions().trim() } : {}),
      ...(this.observations().trim() ? { observaciones: this.observations().trim() } : {}),
    };
  }

  private setCatalogError(error: unknown, catalog: string): void {
    this.catalogError.set(getApiErrorMessage(error, `No fue posible cargar ${catalog}.`));
  }

  private resetForm(): void {
    this.selectedClient.set(null);
    this.clientSearch.set('');
    this.isClientDropdownOpen.set(false);
    this.clearLocationSelection();
    this.selectedTechnicianId.set(null);
    this.selectedTypeId.set(null);
    this.scheduledDate.set('');
    this.scheduledTime.set('');
    this.visitReason.set('');
    this.instructions.set('');
    this.observations.set('');
    this.referencePhoto.set(null);
    this.formError.set('');
    this.revokePhotoUrl();
  }

  private replaceVisit(updatedVisit: VisitaTecnica): void {
    this.visits.update((visits) =>
      visits.map((visit) => (visit.id_visita === updatedVisit.id_visita ? updatedVisit : visit)),
    );
  }

  private loadClientLocations(idCliente: number, preferredLocationId: number | null): void {
    this.areLocationsLoading.set(true);
    this.locationsError.set('');
    this.ubicacionesService
      .getByClient(idCliente)
      .pipe(
        finalize(() => {
          if (this.selectedClientId() === idCliente) {
            this.areLocationsLoading.set(false);
          }
        }),
      )
      .subscribe({
        next: (locations) => {
          // Ignora respuestas tardías si el usuario ya eligió otro cliente.
          if (this.selectedClientId() !== idCliente) {
            return;
          }
          const activeLocations = locations.filter(
            (location) => location.id_cliente === idCliente && location.estado === 'Activo',
          );
          this.clientLocations.set(activeLocations);
          this.selectedLocationId.set(
            activeLocations.some((location) => location.id_ubicacion === preferredLocationId)
              ? preferredLocationId
              : null,
          );
        },
        error: (error: unknown) => {
          if (this.selectedClientId() !== idCliente) {
            return;
          }
          this.locationsError.set(
            getApiErrorMessage(error, 'No fue posible cargar las propiedades del cliente.'),
          );
        },
      });
  }

  private clearLocationSelection(): void {
    this.clientLocations.set([]);
    this.selectedLocationId.set(null);
    this.areLocationsLoading.set(false);
    this.locationsError.set('');
  }

  private revokePhotoUrl(): void {
    if (this.referencePhotoObjectUrl) {
      URL.revokeObjectURL(this.referencePhotoObjectUrl);
      this.referencePhotoObjectUrl = null;
    }
    this.referencePhotoUrl.set(null);
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
