import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, HostListener, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { TicketDetalle } from '../../models/ticket.models';
import { TicketsService } from '../../services/tickets.service';

/** Cierre técnico de soporte: informe y fotografía obligatorios, sin modificar otras tareas. */
@Component({
  selector: 'app-finalizar-soporte',
  imports: [ReactiveFormsModule],
  templateUrl: './finalizar-soporte.component.html',
  styleUrl: './finalizar-soporte.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinalizarSoporteComponent implements OnDestroy {
  private readonly service = inject(TicketsService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private photoRequest = 0;
  private objectUrl: string | null = null;
  @Input({ required: true }) idTicket!: number;
  @Input({ required: true }) cliente!: string;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly saved = new EventEmitter<TicketDetalle>();
  readonly saving = signal(false);
  readonly validatingPhoto = signal(false);
  readonly photo = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly photoError = signal('');
  readonly error = signal('');
  readonly submitted = signal(false);
  readonly form = this.fb.nonNullable.group({
    trabajo_realizado: ['', [Validators.required, Validators.pattern(/\S/)]],
    resultado_solucion: ['', [Validators.required, Validators.pattern(/\S/)]],
    observaciones: [''],
  });

  /** Cámara y galería comparten tipo, tamaño y decodificación; vaciar el input permite reelegir el mismo archivo. */
  onPhotoChange(event: Event): void {
    if (this.saving()) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.item(0);
    input.value = '';
    if (!file) return;
    const request = ++this.photoRequest;
    this.releasePreview(); this.photo.set(null); this.validatingPhoto.set(false); this.photoError.set('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      this.photoError.set('Selecciona una imagen JPG, PNG o WEBP válida de hasta 5 MB.'); input.value = ''; return;
    }
    this.validatingPhoto.set(true);
    const url = URL.createObjectURL(file);
    this.objectUrl = url;
    const image = new Image();
    image.onload = () => {
      if (request !== this.photoRequest) return;
      this.validatingPhoto.set(false);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        this.photo.set(file); this.preview.set(url);
      } else { this.rejectPhoto(input); }
    };
    image.onerror = () => { if (request === this.photoRequest) this.rejectPhoto(input); };
    image.src = url;
  }

  /** Retira solo la evidencia local y descarta lecturas pendientes; permite adjuntar otra sin alterar el informe. */
  removePhoto(cameraInput: HTMLInputElement, galleryInput: HTMLInputElement): void {
    if (this.saving()) return;
    this.photoRequest++;
    this.releasePreview(); this.photo.set(null); this.validatingPhoto.set(false); this.photoError.set('');
    cameraInput.value = ''; galleryInput.value = '';
  }

  /** Bloquea doble envío y exige el archivo validado; el estado cambia solo al confirmar FastAPI. */
  submit(): void {
    if (this.saving() || this.validatingPhoto()) return;
    this.submitted.set(true); this.form.markAllAsTouched(); this.error.set('');
    const photo = this.photo();
    if (!photo) this.photoError.set('La fotografía de evidencia es obligatoria.');
    if (this.form.invalid || !photo || !Number.isInteger(this.idTicket) || this.idTicket <= 0) return;
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.service.complete(this.idTicket, {
      trabajo_realizado: raw.trabajo_realizado.trim(), resultado_solucion: raw.resultado_solucion.trim(),
      observaciones: raw.observaciones.trim() || null,
    }, photo).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.saving.set(false))).subscribe({
      next: (ticket) => { this.releasePreview(); this.saved.emit(ticket); },
      error: (error: unknown) => this.error.set(getApiErrorMessage(error, 'No fue posible finalizar el soporte.')),
    });
  }

  @HostListener('document:keydown.escape')
  cancel(): void {
    if (this.saving()) return;
    this.photoRequest++; this.releasePreview(); this.closed.emit();
  }

  ngOnDestroy(): void { this.photoRequest++; this.releasePreview(); }

  /** Un archivo que no se decodifica nunca se conserva como evidencia válida. */
  private rejectPhoto(input: HTMLInputElement): void {
    this.validatingPhoto.set(false); this.photo.set(null); this.releasePreview();
    this.photoError.set('El archivo no contiene una imagen válida.'); input.value = '';
  }

  /** Libera la URL temporal al reemplazar, cancelar, finalizar o destruir el formulario. */
  private releasePreview(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null; this.preview.set(null);
  }
}
