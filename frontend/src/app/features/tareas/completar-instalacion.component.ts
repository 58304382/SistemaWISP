import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  signal,
} from '@angular/core';

interface InstalacionEnProceso {
  cliente: string;
}

@Component({
  selector: 'app-completar-instalacion',
  templateUrl: './completar-instalacion.component.html',
  styleUrl: './completar-instalacion.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompletarInstalacionComponent implements OnDestroy {
  @Input({ required: true }) task!: InstalacionEnProceso;
  @Output() readonly closed = new EventEmitter<void>();

  readonly technicalObservation = signal('');
  readonly evidencePhoto = signal<File | null>(null);
  readonly evidencePreviewUrl = signal<string | null>(null);
  readonly observationError = signal('');
  readonly evidenceError = signal('');
  readonly formMessage = signal('');
  private evidenceObjectUrl: string | null = null;

  ngOnDestroy(): void {
    this.revokeEvidencePreview();
  }

  onObservationChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLTextAreaElement) {
      this.technicalObservation.set(input.value);
    }
  }

  // Cámara y galería convergen en la misma validación y vista previa, sin duplicar evidencia.
  onPhotoChange(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const photo = input.files?.item(0);
    if (!photo) {
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(photo.type)) {
      this.evidencePhoto.set(null);
      this.evidenceError.set('Selecciona una imagen JPG, JPEG o PNG.');
      this.revokeEvidencePreview();
      input.value = '';
      return;
    }

    this.revokeEvidencePreview();
    this.evidencePhoto.set(photo);
    this.evidenceError.set('');
    // La URL temporal permite previsualizar localmente sin subir ni persistir el archivo.
    if (typeof URL.createObjectURL === 'function') {
      this.evidenceObjectUrl = URL.createObjectURL(photo);
      this.evidencePreviewUrl.set(this.evidenceObjectUrl);
    }
  }

  cancel(): void {
    this.revokeEvidencePreview();
    this.closed.emit();
  }

  // Valida el cierre técnico antes de informar que la persistencia depende de backend.
  submit(event: Event): void {
    event.preventDefault();
    const hasObservation = Boolean(this.technicalObservation().trim());
    const hasEvidence = this.evidencePhoto() !== null;
    this.observationError.set(hasObservation ? '' : 'La observación técnica es obligatoria.');
    this.evidenceError.set(hasEvidence ? '' : 'La evidencia fotográfica es obligatoria.');
    this.formMessage.set('');
    if (!hasObservation || !hasEvidence) {
      return;
    }

    // El estado permanece En Proceso para no aparentar una finalización que no fue guardada.
    this.formMessage.set('La API todavía no permite completar instalaciones ni guardar evidencia.');
  }

  private revokeEvidencePreview(): void {
    if (this.evidenceObjectUrl) {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(this.evidenceObjectUrl);
      }
      this.evidenceObjectUrl = null;
    }
    this.evidencePreviewUrl.set(null);
  }
}
