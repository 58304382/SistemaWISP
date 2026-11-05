import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, finalize, of } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  ConfiguracionComprobanteInputDto,
  ConfiguracionComprobanteResponseDto,
} from '../../models/comprobante-configuracion.models';
import { ComprobanteConfiguracionService } from '../../services/comprobante-configuracion.service';

const VALORES_INICIALES: ConfiguracionComprobanteInputDto = {
  nombre_comercial: '',
  descripcion_empresa: '',
  direccion: '',
  telefono: '',
  mensaje_final: '',
  nota_fiscal: '',
};

const NOMBRE_POR_DEFECTO = 'Multiservicios Tale';
const DESCRIPCION_POR_DEFECTO = 'Servicios de Internet y telecomunicaciones';
const MENSAJE_POR_DEFECTO = '¡Gracias por su preferencia!';

@Component({
  selector: 'app-configuracion-comprobantes',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './configuracion-comprobantes.component.html',
  styleUrl: './configuracion-comprobantes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionComprobantesComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(ComprobanteConfiguracionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly version = signal<number | null>(null);
  readonly estado = signal('Sin configuración');
  readonly valores = signal<ConfiguracionComprobanteInputDto>({
    ...VALORES_INICIALES,
  });
  private readonly valoresGuardados = signal<ConfiguracionComprobanteInputDto>({
    ...VALORES_INICIALES,
  });

  readonly form = this.formBuilder.nonNullable.group({
    nombre_comercial: ['', [Validators.required, Validators.maxLength(150)]],
    descripcion_empresa: ['', [Validators.maxLength(200)]],
    direccion: ['', [Validators.maxLength(300)]],
    telefono: ['', [Validators.maxLength(30)]],
    mensaje_final: [''],
    nota_fiscal: ['', [Validators.maxLength(200)]],
  });

  /** Vista previa en tiempo real con los datos reales del formulario. */
  readonly vistaPrevia = computed(() => {
    const valores = this.valores();
    return {
      nombre: valores.nombre_comercial.trim() || NOMBRE_POR_DEFECTO,
      descripcion: valores.descripcion_empresa.trim() || DESCRIPCION_POR_DEFECTO,
      direccion: valores.direccion.trim() || 'Dirección de la empresa',
      telefono: valores.telefono.trim() || 'Teléfono de contacto',
      mensaje: valores.mensaje_final.trim() || MENSAJE_POR_DEFECTO,
      // La nota fiscal es opcional: vacía no muestra texto ni espacio adicional.
      nota: valores.nota_fiscal.trim(),
    };
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.valores.set(this.form.getRawValue()));
  }

  ngOnInit(): void {
    this.cargar();
  }

  /** Lee la configuración activa; sin versión publicada conserva los valores por defecto. */
  cargar(): void {
    this.cargando.set(true);
    this.errorMessage.set('');
    this.service
      .getActiva()
      .pipe(
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) {
            return of(null);
          }
          throw error;
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cargando.set(false)),
      )
      .subscribe({
        next: (configuracion) => {
          if (configuracion !== null) {
            this.aplicar(configuracion);
          } else {
            this.version.set(null);
            this.estado.set('Sin configuración');
            this.valoresGuardados.set({ ...VALORES_INICIALES });
          }
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible cargar la configuración.'),
          ),
      });
  }

  /** Guarda y activa una versión nueva sin modificar comprobantes históricos. */
  guardar(): void {
    if (this.guardando()) return;
    this.form.markAllAsTouched();
    const nombre = this.form.controls.nombre_comercial.value.trim();
    if (this.form.invalid || !nombre) {
      this.errorMessage.set(
        'El nombre comercial es obligatorio y los campos no deben superar su longitud.',
      );
      return;
    }
    this.guardando.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.service
      .guardar(this.form.getRawValue())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.guardando.set(false)),
      )
      .subscribe({
        next: (configuracion) => {
          this.aplicar(configuracion);
          this.successMessage.set(
            `Configuración versión ${configuracion.version} guardada y activada.`,
          );
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible guardar la configuración.'),
          ),
      });
  }

  /** Restaura los últimos datos cargados o guardados sin llamar al backend. */
  cancelar(): void {
    if (this.guardando()) return;
    this.form.reset({ ...this.valoresGuardados() });
    this.valores.set({ ...this.valoresGuardados() });
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  private aplicar(configuracion: ConfiguracionComprobanteResponseDto): void {
    const valores: ConfiguracionComprobanteInputDto = {
      nombre_comercial: configuracion.nombre_comercial,
      descripcion_empresa: configuracion.descripcion_empresa ?? '',
      direccion: configuracion.direccion ?? '',
      telefono: configuracion.telefono ?? '',
      mensaje_final: configuracion.mensaje_final ?? '',
      nota_fiscal: configuracion.nota_fiscal ?? '',
    };
    this.form.reset(valores);
    this.valores.set(valores);
    this.valoresGuardados.set({ ...valores });
    this.version.set(configuracion.version);
    this.estado.set(configuracion.estado);
  }
}
