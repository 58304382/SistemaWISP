// ==========================================
// IMPORTS
// ==========================================
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, forkJoin, of } from 'rxjs';

import { Cliente } from '../../../clientes/models/cliente.models';
import { Empleado } from '../../../empleados/models/empleado.models';
import {
  Instalacion,
  InstalacionCreate,
  InstalacionUpdate,
  TecnicoInstalacion,
  VisitaProgramable,
} from '../../models/instalacion.models';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { EmpleadosService } from '../../../empleados/services/empleados.service';
import { InstalacionesService } from '../../services/instalaciones.service';
import { API_BASE_URL } from '../../../../core/config/api.config';

// ==========================================
// TIPOS VISUALES DE INSTALACIONES
// ==========================================
type InstallationStatus = 'PROGRAMADA' | 'EN PROCESO' | 'COMPLETADA';

interface InstallationRow {
  id_instalacion: string;
  cliente: string;
  fecha_programada: string;
  hora_programada: string;
  tecnicos: TecnicoInstalacion[];
  estado: InstallationStatus;
}

// ==========================================
// COMPONENTE DE GESTION DE INSTALACIONES
// ==========================================
@Component({
  selector: 'app-gestion-instalaciones',
  imports: [RouterLink, DatePipe],
  templateUrl: './gestion-instalaciones.component.html',
  styleUrl: './gestion-instalaciones.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GestionInstalacionesComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly clientesService = inject(ClientesService);
  private readonly empleadosService = inject(EmpleadosService);
  private readonly instalacionesService = inject(InstalacionesService);
  private visitaRequest = 0;

  // ==========================================
  // CONTENIDO DEFINIDO POR LA RUTA
  // ==========================================
  readonly title = this.route.snapshot.data['title'] as string;
  readonly description = this.route.snapshot.data['description'] as string;
  readonly isInstallations = this.title === 'Instalaciones';
  readonly installations = signal<InstallationRow[]>([]);
  readonly isInstallationModalOpen = signal(false);
  readonly isViewInstallationModalOpen = signal(false);
  readonly isDeleteInstallationModalOpen = signal(false);
  readonly isSuccessModalOpen = signal(false);
  readonly isSavingInstallation = signal(false);
  readonly isLoadingInstallation = signal<number | null>(null);
  readonly isDeletingInstallation = signal<number | null>(null);
  readonly editingInstallationId = signal<number | null>(null);
  readonly selectedInstallation = signal<Instalacion | null>(null);
  readonly pendingDeleteInstallation = signal<InstallationRow | null>(null);
  readonly installationActionError = signal('');
  readonly installationSuccessTitle = signal('Instalación programada correctamente');
  readonly installationSuccessMessage = signal('La instalación se ha registrado correctamente.');
  readonly installationError = signal('');
  readonly installationLoadError = signal('');
  readonly installationSearch = signal('');
  readonly installationStatusFilter = signal<'all' | InstallationStatus>('all');
  readonly clients = signal<Cliente[]>([]);
  readonly technicians = signal<Empleado[]>([]);
  readonly clientSearch = signal('');
  readonly selectedClient = signal<Cliente | null>(null);
  readonly visitasDisponibles = signal<VisitaProgramable[]>([]);
  readonly selectedVisitId = signal<number | null>(null);
  readonly cargandoVisitas = signal(false);
  readonly errorVisitas = signal('');
  readonly installationSource = signal<Instalacion | null>(null);
  readonly selectedVisit = computed(() => this.visitasDisponibles().find((visit) => visit.id_visita === this.selectedVisitId()) ?? null);
  // Permite editar registros históricos sin cambiar una fuente ya vinculada.
  readonly puedeConservarOrigen = computed(() => this.editingInstallationId() !== null &&
    this.selectedClientId() === this.installationSource()?.id_cliente &&
    this.selectedVisitId() === this.installationSource()?.id_visita);
  readonly descripcionVisita = computed(() => this.selectedVisit()?.descripcion_trabajo ??
    (this.puedeConservarOrigen() ? this.installationSource()?.visita?.descripcion_evaluacion : null));
  readonly materialesVisita = computed(() => this.selectedVisit()?.materiales ??
    (this.puedeConservarOrigen() ? this.installationSource()?.visita?.materiales ?? [] : []));
  readonly selectedTechnicianIds = signal<number[]>([]);
  readonly leadTechnicianId = signal<number | null>(null);
  readonly installationDate = signal('');
  readonly installationTime = signal('');
  readonly installationObservations = signal('');
  readonly isClientDropdownOpen = signal(false);
  readonly isLoadingClients = signal(false);
  readonly isLoadingTechnicians = signal(false);
  readonly clientLoadError = signal('');
  readonly technicianLoadError = signal('');
  readonly selectedClientId = computed(() => this.selectedClient()?.id_cliente ?? null);
  readonly selectedTechnicians = computed(() => {
    const selectedIds = new Set(this.selectedTechnicianIds());
    return this.technicians().filter((technician) => selectedIds.has(technician.id_empleado));
  });
  readonly technicianSelectionLabel = computed(() => {
    const selected = this.selectedTechnicians();
    if (!selected.length) {
      return 'Seleccionar técnicos';
    }
    if (selected.length === 1) {
      return this.technicianFullName(selected[0]);
    }
    return `${selected.length} técnicos seleccionados`;
  });
  readonly filteredClients = computed(() => {
    const query = this.normalize(this.clientSearch());
    if (!query) {
      return [];
    }

    return this.clients().filter((client) => {
      const searchableText = this.normalize(
        [
          this.clientCode(client),
          client.nombres,
          client.apellidos,
          client.telefono,
          client.dpi ?? '',
          client.correo ?? '',
          client.direccion,
          client.referencia ?? '',
        ].join(' '),
      );
      return searchableText.includes(query);
    });
  });
  readonly filteredInstallations = computed(() => {
    const query = this.normalize(this.installationSearch());
    const status = this.installationStatusFilter();
    return this.installations().filter((installation) => {
      const technicians = installation.tecnicos
        .map((technician) => `${technician.nombres} ${technician.apellidos}`)
        .join(' ');
      return (
        this.normalize(`${installation.cliente} ${technicians}`).includes(query) &&
        (status === 'all' || installation.estado === status)
      );
    });
  });

  constructor() {
    if (this.isInstallations) {
      this.loadInstallations();
    }
  }

  // ==========================================
  // MODAL VISUAL DE NUEVA INSTALACION
  // ==========================================
  openInstallationModal(): void {
    this.editingInstallationId.set(null);
    this.resetInstallationForm();
    this.clientSearch.set('');
    this.selectedClient.set(null);
    this.isClientDropdownOpen.set(false);
    this.clientLoadError.set('');
    this.technicianLoadError.set('');
    this.loadClients();
    this.loadTechnicians();
    this.isInstallationModalOpen.set(true);
  }

  openViewInstallation(idInstalacion: number): void {
    this.installationActionError.set('');
    this.isLoadingInstallation.set(idInstalacion);
    this.instalacionesService
      .getById(idInstalacion)
      .pipe(finalize(() => this.isLoadingInstallation.set(null)))
      .subscribe({
        next: (installation) => {
          this.selectedInstallation.set(installation);
          this.isViewInstallationModalOpen.set(true);
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible cargar la instalación', error);
          this.installationActionError.set(this.httpErrorMessage(error));
        },
      });
  }

  openEditInstallation(idInstalacion: number): void {
    this.installationActionError.set('');
    this.isLoadingInstallation.set(idInstalacion);
    forkJoin({
      installation: this.instalacionesService.getById(idInstalacion),
      clients: this.clients().length ? of(this.clients()) : this.clientesService.getAll(),
      technicians: this.technicians().length
        ? of(this.technicians())
        : this.empleadosService.getAll(),
    })
      .pipe(finalize(() => this.isLoadingInstallation.set(null)))
      .subscribe({
        next: ({ installation, clients, technicians }) => {
          this.clients.set(clients);
          this.technicians.set(
            technicians.filter(
              (employee) =>
                employee.estado === 'Activo' &&
                this.normalize(employee.nombre_puesto).includes('tecnic'),
            ),
          );
          const client = clients.find((item) => item.id_cliente === installation.id_cliente);
          if (!client) {
            this.installationActionError.set('No fue posible cargar el cliente de la instalación.');
            return;
          }
          this.prepareInstallationForm(installation, client);
          this.isInstallationModalOpen.set(true);
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible cargar la instalación para editarla', error);
          this.installationActionError.set(this.httpErrorMessage(error));
        },
      });
  }

  requestDeleteInstallation(installation: InstallationRow): void {
    this.installationActionError.set('');
    this.pendingDeleteInstallation.set(installation);
    this.isDeleteInstallationModalOpen.set(true);
  }

  closeInstallationModal(): void {
    this.isInstallationModalOpen.set(false);
    this.isClientDropdownOpen.set(false);
  }

  closeSuccessModal(): void {
    this.isSuccessModalOpen.set(false);
  }

  closeViewInstallationModal(): void {
    this.isViewInstallationModalOpen.set(false);
    this.selectedInstallation.set(null);
  }

  /** Resuelve las imágenes del detalle igual que Mis tareas, sin subir ni modificar archivos. */
  installationImageUrl(path: string | null | undefined): string | null {
    if (!path) return null;
    return /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
  }

  closeDeleteInstallationModal(): void {
    if (!this.isDeletingInstallation()) {
      this.isDeleteInstallationModalOpen.set(false);
      this.pendingDeleteInstallation.set(null);
      this.installationActionError.set('');
    }
  }

  loadInstallations(): void {
    this.instalacionesService.getAll().subscribe({
      next: (installations) => {
        this.installations.set(
          installations.map((installation) => this.toInstallationRow(installation)),
        );
        this.installationLoadError.set('');
      },
      error: (error: unknown) => {
        this.logHttpError('No fue posible cargar las instalaciones', error);
        this.installationLoadError.set(this.httpErrorMessage(error));
      },
    });
  }

  loadClients(): void {
    if (this.clients().length || this.isLoadingClients()) {
      return;
    }

    this.isLoadingClients.set(true);
    this.clientesService
      .getAll()
      .pipe(finalize(() => this.isLoadingClients.set(false)))
      .subscribe({
        next: (clients) => {
          this.clients.set(clients);
          this.clientLoadError.set('');
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible cargar los clientes', error);
          this.clientLoadError.set('No fue posible cargar los clientes.');
        },
      });
  }

  loadTechnicians(): void {
    if (this.technicians().length || this.isLoadingTechnicians()) {
      return;
    }

    this.isLoadingTechnicians.set(true);
    this.empleadosService
      .getAll()
      .pipe(finalize(() => this.isLoadingTechnicians.set(false)))
      .subscribe({
        next: (employees) => {
          const activeEmployees = employees.filter((employee) => employee.estado === 'Activo');
          const technicalEmployees = activeEmployees.filter((employee) =>
            this.normalize(employee.nombre_puesto).includes('tecnic'),
          );
          this.technicians.set(technicalEmployees);
          this.technicianLoadError.set('');
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible cargar los técnicos', error);
          this.technicianLoadError.set(this.httpErrorMessage(error));
        },
      });
  }

  onInstallationSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.installationSearch.set(input.value);
    }
  }

  onInstallationStatusFilter(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLSelectElement) {
      this.installationStatusFilter.set(input.value as 'all' | InstallationStatus);
    }
  }

  onClientSearch(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.clientSearch.set(input.value);
    this.selectedClient.set(null);
    this.selectedVisitId.set(null);
    this.visitasDisponibles.set([]);
    this.visitaRequest++;
    this.isClientDropdownOpen.set(true);
  }

  openClientDropdown(): void {
    if (this.clientSearch().trim()) {
      this.isClientDropdownOpen.set(true);
    }
  }

  closeClientDropdown(): void {
    this.isClientDropdownOpen.set(false);
  }

  selectClient(client: Cliente): void {
    this.selectedClient.set(client);
    this.clientSearch.set(this.clientFullName(client));
    this.isClientDropdownOpen.set(false);
    this.cargarVisitas(client.id_cliente);
  }

  /** Consulta el contexto permitido por Instalaciones y descarta respuestas de otro cliente. */
  private cargarVisitas(idCliente: number, conservarVisita?: number | null): void {
    const request = ++this.visitaRequest;
    this.visitasDisponibles.set([]);
    this.selectedVisitId.set(conservarVisita ?? null);
    this.cargandoVisitas.set(true);
    this.errorVisitas.set('');
    this.instalacionesService.getVisitasDisponibles(idCliente)
      .pipe(finalize(() => { if (request === this.visitaRequest) this.cargandoVisitas.set(false); }))
      .subscribe({
        next: (visitas) => {
          if (request !== this.visitaRequest) return;
          this.visitasDisponibles.set(visitas);
          if (conservarVisita === undefined && visitas.length === 1) this.selectedVisitId.set(visitas[0].id_visita);
        },
        error: (error: unknown) => {
          if (request === this.visitaRequest) this.errorVisitas.set(this.httpErrorMessage(error));
        },
      });
  }

  onVisitSelection(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.selectedVisitId.set(Number(event.target.value) || null);
  }

  changeClient(): void {
    this.selectedClient.set(null);
    this.clientSearch.set('');
    this.isClientDropdownOpen.set(false);
    this.selectedVisitId.set(null);
    this.visitasDisponibles.set([]);
    this.visitaRequest++;
  }

  // Mantiene al encargado dentro del equipo seleccionado y lo limpia si deja de pertenecer a él.
  onTechnicianSelectionChange(idEmpleado: number, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.selectedTechnicianIds.update((selectedIds) =>
      input.checked ? [...selectedIds, idEmpleado] : selectedIds.filter((id) => id !== idEmpleado),
    );
    if (!input.checked && this.leadTechnicianId() === idEmpleado) {
      this.leadTechnicianId.set(null);
    }
    if (this.selectedTechnicianIds().length < 2) {
      this.leadTechnicianId.set(null);
    }
  }

  onLeadTechnicianChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLSelectElement)) {
      return;
    }

    const id = Number(input.value);
    this.leadTechnicianId.set(
      Number.isInteger(id) && this.selectedTechnicianIds().includes(id) ? id : null,
    );
  }

  onInstallationDateChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.installationDate.set(input.value);
    }
  }

  onInstallationTimeChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.installationTime.set(input.value);
    }
  }

  onInstallationObservationsChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLTextAreaElement) {
      this.installationObservations.set(input.value);
    }
  }

  saveInstallation(event: Event): void {
    event.preventDefault();
    this.installationError.set('');

    const client = this.selectedClient();
    const editingId = this.editingInstallationId();
    const selectedIds = this.selectedTechnicianIds();
    const leadId = selectedIds.length === 1 ? selectedIds[0] : this.leadTechnicianId();

    if (!client || !selectedIds.length || !leadId) {
      this.installationError.set(
        selectedIds.length > 1 && !this.leadTechnicianId()
          ? 'Selecciona el técnico encargado antes de continuar.'
          : 'Selecciona un cliente y al menos un técnico antes de continuar.',
      );
      return;
    }
    if (!this.installationDate() || !this.installationTime()) {
      this.installationError.set('Completa los campos obligatorios de la instalación.');
      return;
    }
    // Una instalación nueva (o un cambio de fuente) requiere visita COMPLETADA
    // en Cobros y usa exactamente la ubicación que devuelve el servidor.
    const visita = this.selectedVisit();
    if ((!visita && !this.puedeConservarOrigen()) || (visita && visita.id_ubicacion === null)) {
      this.installationError.set('Seleccione una visita con cotización COMPLETADA y ubicación registrada.');
      return;
    }

    if (editingId !== null) {
      this.saveEditedInstallation(editingId, client.id_cliente, leadId);
      return;
    }

    const data: InstalacionCreate = {
      id_cliente: client.id_cliente,
      id_visita: visita!.id_visita,
      id_ubicacion: visita!.id_ubicacion,
      fecha_programada: this.installationDate(),
      hora_programada: this.installationTime(),
      observaciones: this.installationObservations().trim() || null,
      tecnicos: selectedIds.map((idEmpleado) => ({
        id_empleado: idEmpleado,
        es_encargado: idEmpleado === leadId,
      })),
    };

    this.isSavingInstallation.set(true);
    this.instalacionesService.create(data).subscribe({
      next: () => this.finishInstallationSave(),
      error: (error: unknown) => {
        this.isSavingInstallation.set(false);
        this.logHttpError('No fue posible programar la instalación', error);
        this.installationError.set(this.httpErrorMessage(error));
      },
    });
  }

  clientCode(client: Cliente): string {
    return String(client.id_cliente);
  }

  clientFullName(client: Cliente): string {
    return `${client.nombres} ${client.apellidos}`.trim();
  }

  technicianFullName(technician: Empleado): string {
    return `${technician.nombres} ${technician.apellidos}`.trim();
  }

  formatInstallationDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
  }

  formatInstallationTime(value: string): string {
    return value.slice(0, 5);
  }

  confirmDeleteInstallation(): void {
    const installation = this.pendingDeleteInstallation();
    if (!installation || this.isDeletingInstallation()) {
      return;
    }

    const idInstalacion = Number(installation.id_instalacion);
    this.installationActionError.set('');
    this.isDeletingInstallation.set(idInstalacion);
    this.instalacionesService
      .delete(idInstalacion)
      .pipe(finalize(() => this.isDeletingInstallation.set(null)))
      .subscribe({
        next: () => {
          this.installations.update((items) =>
            items.filter((item) => item.id_instalacion !== installation.id_instalacion),
          );
          this.isDeleteInstallationModalOpen.set(false);
          this.pendingDeleteInstallation.set(null);
          this.loadInstallations();
          this.showSuccess(
            'Instalación eliminada correctamente',
            'La instalación fue eliminada del sistema.',
          );
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible eliminar la instalación', error);
          this.installationActionError.set(this.httpErrorMessage(error));
        },
      });
  }

  private resetInstallationForm(): void {
    this.editingInstallationId.set(null);
    this.selectedTechnicianIds.set([]);
    this.leadTechnicianId.set(null);
    this.installationDate.set('');
    this.installationTime.set('');
    this.installationObservations.set('');
    this.installationError.set('');
    this.visitaRequest++;
    this.visitasDisponibles.set([]);
    this.selectedVisitId.set(null);
    this.installationSource.set(null);
    this.errorVisitas.set('');
    this.cargandoVisitas.set(false);
  }

  private prepareInstallationForm(installation: Instalacion, client: Cliente): void {
    this.resetInstallationForm();
    this.editingInstallationId.set(installation.id_instalacion);
    this.selectedClient.set(client);
    this.installationSource.set(installation);
    this.clientSearch.set(this.clientFullName(client));
    this.selectedTechnicianIds.set(
      installation.tecnicos.map((technician) => technician.id_empleado),
    );
    this.leadTechnicianId.set(installation.encargado.id_empleado);
    this.installationDate.set(installation.fecha_programada);
    this.installationTime.set(installation.hora_programada.slice(0, 5));
    this.installationObservations.set(installation.observaciones ?? '');
    this.isClientDropdownOpen.set(false);
    this.cargarVisitas(client.id_cliente, installation.id_visita);
  }

  private saveEditedInstallation(idInstalacion: number, idCliente: number, leadId: number): void {
    const data: InstalacionUpdate = {
      id_cliente: idCliente,
      ...(this.selectedVisit() ? {
        id_visita: this.selectedVisit()!.id_visita,
        id_ubicacion: this.selectedVisit()!.id_ubicacion,
      } : {}),
      fecha_programada: this.installationDate(),
      hora_programada: this.installationTime(),
      observaciones: this.installationObservations().trim() || null,
      tecnicos: this.selectedTechnicianIds().map((idEmpleado) => ({
        id_empleado: idEmpleado,
        es_encargado: idEmpleado === leadId,
      })),
    };
    this.isSavingInstallation.set(true);
    this.instalacionesService
      .update(idInstalacion, data)
      .pipe(finalize(() => this.isSavingInstallation.set(false)))
      .subscribe({
        next: () => {
          this.closeInstallationModal();
          this.resetInstallationForm();
          this.loadInstallations();
          this.showSuccess(
            'Instalación actualizada correctamente',
            'Los datos de la instalación se han guardado.',
          );
        },
        error: (error: unknown) => {
          this.logHttpError('No fue posible editar la instalación', error);
          this.installationError.set(this.httpErrorMessage(error));
        },
      });
  }

  private finishInstallationSave(): void {
    this.isSavingInstallation.set(false);
    this.closeInstallationModal();
    this.resetInstallationForm();
    this.loadInstallations();
    this.showSuccess(
      'Instalación programada correctamente',
      'La instalación se ha registrado correctamente.',
    );
  }

  private showSuccess(title: string, message: string): void {
    this.installationSuccessTitle.set(title);
    this.installationSuccessMessage.set(message);
    this.isSuccessModalOpen.set(true);
  }

  private toInstallationRow(installation: Instalacion): InstallationRow {
    const status = installation.estado.toUpperCase() as InstallationStatus;
    return {
      id_instalacion: String(installation.id_instalacion),
      cliente: installation.cliente.nombre,
      fecha_programada: installation.fecha_programada,
      hora_programada: installation.hora_programada.slice(0, 5),
      tecnicos: installation.tecnicos,
      estado: status,
    };
  }

  private logHttpError(context: string, error: unknown): void {
    console.error(context, error);
  }

  private httpErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const detail = error.error?.detail;
      if (typeof detail === 'string' && detail.trim()) {
        return detail;
      }
      if (error.status) {
        return `La API respondió con error HTTP ${error.status}.`;
      }
    }
    return 'No fue posible completar la operación.';
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
