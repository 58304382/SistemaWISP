import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { AuthService } from '../../../auth/services/auth.service';
import { CanalTicket, CategoriaTicket, ClienteTicket, TecnicoTicket, Ticket, TicketDetalle, TicketWrite } from '../../models/ticket.models';
import { TicketsService } from '../../services/tickets.service';
import { TicketDetalleComponent } from '../ticket-detalle/ticket-detalle.component';

/** Gestión administrativa con datos reales, sin ejecución de tickets desde Tareas. */
@Component({
  selector: 'app-soporte-tecnico',
  imports: [DatePipe, ReactiveFormsModule, TicketDetalleComponent],
  templateUrl: './soporte-tecnico.component.html',
  styleUrl: './soporte-tecnico.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SoporteTecnicoComponent implements OnInit {
  private readonly service = inject(TicketsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private detailRequest = 0;

  readonly tickets = signal<Ticket[]>([]);
  readonly categorias = signal<CategoriaTicket[]>([]);
  readonly clientes = signal<ClienteTicket[]>([]);
  readonly tecnicos = signal<TecnicoTicket[]>([]);
  readonly loading = signal(false);
  readonly loadingCatalogs = signal(false);
  readonly saving = signal(false);
  readonly loadingDetail = signal(false);
  readonly error = signal('');
  readonly catalogError = signal('');
  readonly modalError = signal('');
  readonly success = signal('');
  readonly search = signal('');
  readonly estado = signal('');
  readonly modal = signal<'form' | 'view' | 'delete' | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly detail = signal<TicketDetalle | null>(null);
  readonly deleting = signal<Ticket | null>(null);
  readonly submitted = signal(false);
  readonly canManage = computed(() => this.auth.hasModule('tickets'));
  readonly estados = ['Programada', 'En Proceso', 'Completada'] as const;

  /** Los resúmenes reflejan el listado real; los filtros solo cambian las filas visibles. */
  readonly resumen = computed(() => this.estados.map((estado) => ({
    estado, cantidad: this.tickets().filter((ticket) => ticket.estado === estado).length,
  })));
  /** Combina Estado con palabras sin acentos sobre código, cliente, teléfono, asunto o técnico. */
  readonly filteredTickets = computed(() => {
    const words = this.normalize(this.search()).split(/\s+/).filter(Boolean);
    return this.tickets().filter((ticket) =>
      (!this.estado() || ticket.estado === this.estado()) &&
      words.every((word) => this.normalize([
        ticket.codigo, ticket.cliente, ticket.telefono_cliente, ticket.asunto, ticket.tecnico ?? '',
      ].join(' ')).includes(word)),
    );
  });

  readonly form = this.fb.nonNullable.group({
    id_cliente: [0, [Validators.required, Validators.min(1)]],
    canal: ['Llamada' as CanalTicket, Validators.required],
    id_categoria: [0, [Validators.required, Validators.min(1)]],
    id_tecnico: [0, [Validators.required, Validators.min(1)]],
    asunto: ['', [Validators.required, Validators.maxLength(200), Validators.pattern(/\S/)]],
    descripcion: ['', [Validators.required, Validators.pattern(/\S/)]],
    observaciones: [''],
  });

  ngOnInit(): void {
    this.loadTickets();
    this.loadCatalogs();
  }

  /** Se reutiliza para reintentar errores de red sin introducir filas de ejemplo. */
  loadTickets(): void {
    if (!this.canManage() || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.service.getAll().pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false))).subscribe({
      next: (tickets) => this.tickets.set(tickets),
      error: (error: unknown) => this.error.set(getApiErrorMessage(error, 'No fue posible cargar los tickets.')),
    });
  }

  /** Catálogos reales; un fallo bloquea el guardado hasta completar la carga. */
  loadCatalogs(): void {
    if (!this.canManage() || this.loadingCatalogs()) return;
    this.loadingCatalogs.set(true);
    this.catalogError.set('');
    forkJoin({ categorias: this.service.getCategorias(), clientes: this.service.getClientes(), tecnicos: this.service.getTecnicos() })
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loadingCatalogs.set(false))).subscribe({
        next: (data) => { this.categorias.set(data.categorias); this.clientes.set(data.clientes); this.tecnicos.set(data.tecnicos); },
        error: (error: unknown) => this.catalogError.set(getApiErrorMessage(error, 'No fue posible cargar los catálogos de soporte.')),
      });
  }

  /** Actualiza únicamente los dos controles de consulta disponibles en el listado. */
  filter(event: Event, field: 'search' | 'estado'): void {
    const input = event.target;
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) this[field].set(input.value);
  }

  /** Esta regla visual se repite en backend bajo bloqueo transaccional. */
  canEdit(ticket: Ticket): boolean { return this.canManage() && ticket.estado === 'Programada'; }

  openCreate(): void {
    if (!this.canManage() || this.saving()) return;
    this.detailRequest += 1;
    this.loadingDetail.set(false);
    this.editingId.set(null);
    this.form.reset({ id_cliente: 0, id_categoria: 0, id_tecnico: 0, canal: 'Llamada', asunto: '', descripcion: '', observaciones: '' });
    this.submitted.set(false); this.modalError.set(''); this.modal.set('form');
  }

  /** Descarta respuestas tardías al cerrar/cambiar de modal y consulta el estado vigente. */
  openDetail(ticket: Ticket, edit = false): void {
    if (!this.canManage() || this.saving() || (edit && !this.canEdit(ticket))) return;
    const request = ++this.detailRequest;
    this.modalError.set(''); this.detail.set(null); this.editingId.set(null);
    this.loadingDetail.set(true); this.modal.set('view');
    this.service.getById(ticket.id_ticket).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        if (request !== this.detailRequest) return;
        this.loadingDetail.set(false); this.detail.set(detail);
        this.replaceTicket(detail);
        if (!edit) return;
        if (!this.canEdit(detail)) { this.modalError.set('El ticket ya no está Programada. Solo se permite consultar.'); return; }
        this.editingId.set(detail.id_ticket);
        this.form.reset({ ...detail, id_tecnico: detail.id_tecnico ?? 0, canal: detail.canal as CanalTicket, observaciones: detail.observaciones ?? '' });
        this.submitted.set(false); this.modal.set('form');
      },
      error: (error: unknown) => {
        if (request !== this.detailRequest) return;
        this.loadingDetail.set(false); this.modalError.set(getApiErrorMessage(error, 'No fue posible consultar el ticket.'));
      },
    });
  }

  /** Envía únicamente campos administrativos y actualiza la tabla tras confirmación del servidor. */
  save(): void {
    if (!this.canManage() || this.saving() || this.loadingCatalogs() || this.catalogError() || this.modal() !== 'form') return;
    this.submitted.set(true); this.form.markAllAsTouched(); this.modalError.set('');
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const data: TicketWrite = { ...raw, asunto: raw.asunto.trim(), descripcion: raw.descripcion.trim(), observaciones: raw.observaciones.trim() || null };
    const id = this.editingId();
    this.saving.set(true);
    const operation = id === null ? this.service.create(data) : this.service.update(id, data);
    operation.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.saving.set(false))).subscribe({
      next: (ticket) => {
        this.replaceTicket(ticket); this.modal.set(null);
        this.success.set(`${ticket.codigo} ${id === null ? 'registrado' : 'actualizado'} correctamente.`);
      },
      error: (error: unknown) => this.modalError.set(getApiErrorMessage(error, 'No fue posible guardar el ticket.')),
    });
  }

  /** La confirmación informa que la eliminación física incluye el historial. */
  requestDelete(ticket: Ticket): void {
    if (!this.canEdit(ticket) || this.saving()) return;
    this.detailRequest += 1; this.loadingDetail.set(false);
    this.deleting.set(ticket); this.modalError.set(''); this.modal.set('delete');
  }

  confirmDelete(): void {
    const ticket = this.deleting();
    if (!ticket || !this.canEdit(ticket) || this.saving() || this.modal() !== 'delete') return;
    this.saving.set(true); this.modalError.set('');
    this.service.delete(ticket.id_ticket).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.tickets.update((rows) => rows.filter((row) => row.id_ticket !== ticket.id_ticket));
        this.modal.set(null); this.deleting.set(null); this.success.set(`${ticket.codigo} eliminado correctamente.`);
      },
      error: (error: unknown) => this.modalError.set(getApiErrorMessage(error, 'No fue posible eliminar el ticket.')),
    });
  }

  @HostListener('document:keydown.escape')
  closeModal(): void {
    if (this.saving()) return;
    this.detailRequest += 1; this.loadingDetail.set(false); this.modal.set(null);
    this.detail.set(null); this.deleting.set(null); this.modalError.set('');
  }

  /** Sustituye solo la fila confirmada; conserva datos y filtros de los demás tickets. */
  private replaceTicket(ticket: Ticket): void {
    this.tickets.update((rows) => rows.some((row) => row.id_ticket === ticket.id_ticket)
      ? rows.map((row) => row.id_ticket === ticket.id_ticket ? ticket : row) : [ticket, ...rows]);
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
