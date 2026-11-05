import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  signal,
  inject,
} from '@angular/core';
import { finalize } from 'rxjs';
import { Instalacion } from '../../../instalaciones/models/instalacion.models';
import { InstalacionesService } from '../../../instalaciones/services/instalaciones.service';
import { getApiErrorMessage } from '../../../../core/utils/api-error';

interface InstalacionEnProceso {
  cliente: string;
  id_instalacion?: number | null;
}

@Component({
  selector: 'app-completar-instalacion',
  templateUrl: './completar-instalacion.component.html',
  styleUrl: './completar-instalacion.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompletarInstalacionComponent implements OnDestroy {
  private readonly instalacionesService = inject(InstalacionesService);
  @Input({ required: true }) task!: InstalacionEnProceso;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly saved = new EventEmitter<Instalacion>();
  readonly isSaving = signal(false);

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
    if (this.isSaving()) return;
    this.revokeEvidencePreview();
    this.closed.emit();
  }

  // Reutiliza el cierre multipart existente; FastAPI valida estado, asignación y evidencia.
  submit(event: Event): void {
    event.preventDefault();
    if (this.isSaving()) return;
    const hasObservation = Boolean(this.technicalObservation().trim());
    const hasEvidence = this.evidencePhoto() !== null;
    this.observationError.set(hasObservation ? '' : 'La observación técnica es obligatoria.');
    this.evidenceError.set(hasEvidence ? '' : 'La evidencia fotográfica es obligatoria.');
    this.formMessage.set('');
    if (!hasObservation || !hasEvidence) {
      return;
    }

    const idInstalacion = this.task.id_instalacion;
    if (idInstalacion == null) {
      this.formMessage.set('La instalación no tiene un identificador válido.');
      return;
    }
    this.isSaving.set(true);
    this.instalacionesService.complete(idInstalacion, this.technicalObservation().trim(), this.evidencePhoto()!)
      .pipe(finalize(() => this.isSaving.set(false)))
      .subscribe({
        next: (installation) => {
          this.revokeEvidencePreview();
          this.saved.emit(installation);
        },
        error: (error: unknown) => this.formMessage.set(
          getApiErrorMessage(error, 'No fue posible completar la instalación.'),
        ),
      });
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
