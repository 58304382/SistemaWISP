import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { finalize, switchMap, tap } from 'rxjs';

import {
  EvaluacionVisitaPayload,
  MaterialEvaluacionVisitaInput,
  VisitaTecnica,
} from '../../core/models/visita-tecnica.models';
import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { getApiErrorMessage } from '../../core/utils/api-error';

import type { EstadoTarea } from './tareas.component';

export interface EvaluacionTecnica {
  descripcionTrabajo: string;
  tecnicosRecomendados: number | null;
  materiales: string[];
  materialesDetalle?: MaterialEvaluacionVisitaInput[];
  condicionesLugar: string | null;
  observacionTecnica: string | null;
  ubicacionRegistrada: boolean;
}

interface VisitaEvaluable {
  id_visita: number | null;
  cliente: string;
  estado: EstadoTarea;
  tecnico?: string;
  fecha?: string;
  hora?: string;
  tipoInstalacion?: string;
  descripcion?: string;
  soloLectura?: boolean;
  evaluacion?: EvaluacionTecnica;
}

type EvaluationField =
  'descripcionTrabajo' | 'tecnicosRecomendados' | 'condicionesLugar' | 'observacionTecnica';
type MaterialField = 'descripcion' | 'cantidad' | 'unidad';

@Component({
  selector: 'app-evaluacion-visita',
  templateUrl: './evaluacion-visita.component.html',
  styleUrl: './evaluacion-visita.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EvaluacionVisitaComponent implements OnInit {
  private readonly visitasService = inject(VisitasTecnicasService);

  @Input({ required: true }) task!: VisitaEvaluable;
  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly progressed = new EventEmitter<VisitaTecnica>();
  @Output() readonly saved = new EventEmitter<VisitaTecnica>();

  readonly descripcionTrabajo = signal('');
  readonly tecnicosRecomendados = signal<number | null>(null);
  readonly materialesDetalle = signal<MaterialEvaluacionVisitaInput[]>([]);
  readonly materialErrors = signal<Record<number, Partial<Record<MaterialField, string>>>>({});
  readonly condicionesLugar = signal('');
  readonly observacionTecnica = signal('');
  readonly errors = signal<Partial<Record<EvaluationField, string>>>({});
  readonly formMessage = signal('');
  readonly locationMessage = signal('');
  readonly isSaving = signal(false);
  readonly evaluationState = signal<EstadoTarea>('Programada');

  // Completada reutiliza exactamente los mismos controles, pero impide toda modificación.
  get readonlyMode(): boolean {
    return this.task.soloLectura === true || this.evaluationState() === 'Completada';
  }

  /** Interpreta el estado real para conservar los títulos y acciones ya diseñados. */
  get title(): string {
    if (this.task.soloLectura) {
      return `Ver visita - ID ${this.task.id_visita}`;
    }
    const action =
      this.evaluationState() === 'Programada'
        ? 'Realizar evaluación'
        : this.evaluationState() === 'En Proceso'
          ? 'Continuar evaluación'
          : 'Ver evaluación';
    return `${action} - ID ${this.task.id_visita}`;
  }

  // Al continuar o consultar se copia la evaluación existente para no crear una segunda instancia.
  ngOnInit(): void {
    this.evaluationState.set(this.task.estado);
    const evaluation = this.task.evaluacion;
    if (!evaluation) {
      return;
    }
    this.descripcionTrabajo.set(evaluation.descripcionTrabajo);
    this.tecnicosRecomendados.set(evaluation.tecnicosRecomendados);
    this.materialesDetalle.set(
      evaluation.materialesDetalle?.map((material) => ({ ...material })) ??
        evaluation.materiales.map((descripcion) => ({
          descripcion,
          cantidad: 1,
          unidad: null,
        })),
    );
    this.condicionesLugar.set(evaluation.condicionesLugar ?? '');
    this.observacionTecnica.set(evaluation.observacionTecnica ?? '');
  }

  /** Mantiene el modal abierto mientras una transición de estado sigue pendiente. */
  close(): void {
    if (!this.isSaving()) {
      this.closed.emit();
    }
  }

  onDescriptionChange(event: Event): void {
    this.descripcionTrabajo.set(this.textareaValue(event));
  }

  onTechniciansChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      const value = Number(input.value);
      this.tecnicosRecomendados.set(input.value && Number.isFinite(value) ? value : null);
    }
  }

  onConditionsChange(event: Event): void {
    this.condicionesLugar.set(this.textareaValue(event));
  }

  onObservationChange(event: Event): void {
    this.observacionTecnica.set(this.textareaValue(event));
  }

  // Cada fila conserva la estructura real que FastAPI utiliza después al crear Cotizaciones.
  addMaterial(): void {
    if (!this.readonlyMode) {
      this.materialesDetalle.update((materials) => [
        ...materials,
        { descripcion: '', cantidad: 1, unidad: null },
      ]);
    }
  }

  updateMaterial(index: number, field: MaterialField, event: Event): void {
    if (this.readonlyMode) {
      return;
    }
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.materialesDetalle.update((materials) =>
        materials.map((material, position) => {
          if (position !== index) {
            return material;
          }
          if (field === 'cantidad') {
            return { ...material, cantidad: input.value === '' ? 0 : Number(input.value) };
          }
          return { ...material, [field]: input.value };
        }),
      );
      this.materialErrors.set({});
    }
  }

  removeMaterial(index: number): void {
    if (!this.readonlyMode) {
      this.materialesDetalle.update((materials) =>
        materials.filter((_, position) => position !== index),
      );
      this.materialErrors.set({});
    }
  }

  // La acción queda visible sin simular mapas ni coordenadas que el sistema aún no proporciona.
  requestLocation(): void {
    if (!this.readonlyMode) {
      this.locationMessage.set('La integración de ubicación todavía no está disponible.');
    }
  }

  // Valida el formulario visual y persiste sobre la evaluación asociada al id_visita real.
  submit(event: Event): void {
    event.preventDefault();
    if (this.readonlyMode || this.isSaving()) {
      return;
    }
    const technicians = this.tecnicosRecomendados();
    const errors: Partial<Record<EvaluationField, string>> = {};
    if (!this.descripcionTrabajo().trim()) {
      errors.descripcionTrabajo = 'La descripción del trabajo es obligatoria.';
    }
    if (technicians === null || !Number.isInteger(technicians) || technicians <= 0) {
      errors.tecnicosRecomendados = 'Ingresa una cantidad válida mayor a 0.';
    }
    if (!this.condicionesLugar().trim()) {
      errors.condicionesLugar = 'Las condiciones del lugar son obligatorias.';
    }
    if (!this.observacionTecnica().trim()) {
      errors.observacionTecnica = 'La observación técnica es obligatoria.';
    }
    const materialErrors = this.validateMaterials();
    this.errors.set(errors);
    this.materialErrors.set(materialErrors);
    this.formMessage.set('');
    if (Object.keys(errors).length || Object.keys(materialErrors).length) {
      return;
    }
    if (this.task.id_visita === null) {
      this.formMessage.set('La visita seleccionada no tiene un identificador válido.');
      return;
    }

    const payload = this.buildPayload(technicians!);
    const idVisita = this.task.id_visita;
    // Programada debe crear primero la evaluación única; el mismo envío la finaliza porque
    // el botón existente representa "Terminar evaluación". En Proceso nunca crea otra.
    const request =
      this.evaluationState() === 'Programada'
        ? this.visitasService.startEvaluation(idVisita, payload).pipe(
            tap((visit) => {
              // Si finalizar falla, la UI conserva En Proceso y no vuelve a crear la evaluación.
              this.evaluationState.set('En Proceso');
              this.progressed.emit(visit);
            }),
            switchMap(() => this.visitasService.finishEvaluation(idVisita, payload)),
          )
        : this.visitasService.finishEvaluation(idVisita, payload);

    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (visit) => this.saved.emit(visit),
      error: (error: unknown) => {
        this.formMessage.set(
          getApiErrorMessage(error, 'No fue posible guardar la evaluación técnica.'),
        );
      },
    });
  }

  /** Traduce cada fila al contrato snake_case sin recalcular sus valores. */
  private buildPayload(technicians: number): EvaluacionVisitaPayload {
    const materials = this.materialesDetalle().map((material) => ({
      descripcion: material.descripcion.trim(),
      cantidad: material.cantidad,
      unidad: material.unidad?.trim() || null,
    }));
    return {
      descripcion_trabajo: this.descripcionTrabajo().trim(),
      tecnicos_recomendados: technicians,
      condiciones_lugar: this.condicionesLugar().trim(),
      observacion_tecnica: this.observacionTecnica().trim(),
      materiales: materials,
    };
  }

  private textareaValue(event: Event): string {
    return event.target instanceof HTMLTextAreaElement ? event.target.value : '';
  }

  private validateMaterials(): Record<number, Partial<Record<MaterialField, string>>> {
    const errors: Record<number, Partial<Record<MaterialField, string>>> = {};
    this.materialesDetalle().forEach((material, index) => {
      const rowErrors: Partial<Record<MaterialField, string>> = {};
      const description = material.descripcion.trim();
      const unit = material.unidad?.trim();
      if (!description) {
        rowErrors.descripcion = 'La descripción es obligatoria.';
      } else if (description.length > 200) {
        rowErrors.descripcion = 'La descripción no puede exceder 200 caracteres.';
      }
      if (!Number.isFinite(material.cantidad) || material.cantidad <= 0) {
        rowErrors.cantidad = 'La cantidad debe ser mayor que 0.';
      }
      if (unit && unit.length > 30) {
        rowErrors.unidad = 'La unidad no puede exceder 30 caracteres.';
      }
      if (Object.keys(rowErrors).length) {
        errors[index] = rowErrors;
      }
    });
    return errors;
  }
}
