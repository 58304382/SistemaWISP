import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { API_BASE_URL } from '../../../../core/config/api.config';
import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  ConfiguracionDocumentoInputDto,
  ConfiguracionDocumentoResponseDto,
  DatosEmpresaDocumento,
  DocumentoComercial,
  TipoDocumentoComercial,
} from '../../models/cotizacion.models';
import { CotizacionesService } from '../../services/cotizaciones.service';
import { DocumentoComercialComponent } from '../documento-comercial/documento-comercial.component';

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

@Component({
  selector: 'app-configuracion-documentos',
  imports: [DocumentoComercialComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './configuracion-documentos.component.html',
  styleUrl: './configuracion-documentos.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionDocumentosComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(CotizacionesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly version = signal<number | null>(null);
  readonly estado = signal('Sin configuración');
  readonly logo = signal<File | null>(null);
  readonly logoPreview = signal<string | null>(null);
  readonly tipoPreview = signal<TipoDocumentoComercial>('COTIZACION');
  readonly valores = signal<ConfiguracionDocumentoInputDto>({
    nombre_comercial: '', nit: '', direccion: '', telefono: '', correo: '',
    terminos_cotizacion: '', terminos_proforma: '', mensaje_final: '',
  });

  readonly form = this.formBuilder.nonNullable.group({
    nombre_comercial: ['', [Validators.required, Validators.maxLength(150)]],
    nit: ['', Validators.maxLength(20)],
    direccion: [''],
    telefono: ['', Validators.maxLength(25)],
    correo: ['', [Validators.email, Validators.maxLength(150)]],
    terminos_cotizacion: [''],
    terminos_proforma: [''],
    mensaje_final: [''],
  });

  readonly documentoPreview = computed<DocumentoComercial>(() => {
    const tipo = this.tipoPreview();
    const hoy = new Date().toISOString();
    return {
      tipo,
      fecha_generacion: tipo === 'PROFORMA' ? hoy : null,
      empresa: this.empresaPreview(tipo),
      cotizacion: {
        id_cotizacion: 0,
        numero_cotizacion: 'COT-000001',
        fecha: hoy,
        fecha_actualizacion: hoy,
        estado: 'GENERADA',
        origen: 'DIRECTA',
        id_evaluacion: null,
        id_evaluacion_orden: null,
        tipo_trabajo: null,
        cliente: {
          id_cliente: 0,
          nombres: 'Cliente',
          apellidos: 'de ejemplo',
          telefono: '5555-5555',
          direccion: 'Dirección del cliente',
          departamento: 'Guatemala',
          municipio: 'Guatemala',
        },
        detalles: [{
          id_detalle: 0,
          descripcion: 'Servicio de ejemplo',
          cantidad: 1,
          unidad: 'Unidad',
          precio_unitario: 100,
          subtotal_detalle: 100,
        }],
        porcentaje_descuento: 0,
        subtotal: 100,
        monto_descuento: 0,
        total: 100,
        tiene_proforma: tipo === 'PROFORMA',
        proforma: null,
      },
    };
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.valores.set(this.form.getRawValue()));
    this.destroyRef.onDestroy(() => this.liberarLogoTemporal());
  }

  ngOnInit(): void {
    this.cargarUltima();
  }

  /** Carga el último borrador o versión publicada para continuar su edición. */
  cargarUltima(): void {
    this.cargando.set(true);
    this.errorMessage.set('');
    this.service.getLatestDocumentConfiguration()
      .pipe(
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 404) return of(null);
          throw error;
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cargando.set(false)),
      )
      .subscribe({
        next: (configuracion) => {
          if (configuracion !== null) this.aplicarConfiguracion(configuracion);
        },
        error: (error: unknown) => this.errorMessage.set(
          getApiErrorMessage(error, 'No fue posible cargar la configuración.'),
        ),
      });
  }

  /** Valida tipo, tamaño y decodificación antes de enviar el logo al backend. */
  seleccionarLogo(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const archivo = input.files?.[0] ?? null;
    if (archivo === null) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type) || archivo.size > MAX_LOGO_BYTES) {
      this.rechazarLogo(input, 'El logotipo debe ser JPEG, PNG o WEBP y no superar 5 MB.');
      return;
    }
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onload = () => {
      this.liberarLogoTemporal();
      this.logo.set(archivo);
      this.logoPreview.set(url);
      this.errorMessage.set('');
    };
    imagen.onerror = () => {
      URL.revokeObjectURL(url);
      this.rechazarLogo(input, 'No fue posible leer el logotipo seleccionado.');
    };
    imagen.src = url;
  }

  /** Guarda una versión nueva y la publica para que los documentos la utilicen. */
  guardar(): void {
    if (this.guardando()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.form.controls.nombre_comercial.value.trim()) {
      this.errorMessage.set('Revise los campos obligatorios y sus longitudes.');
      return;
    }
    const payload = this.form.getRawValue();
    this.guardando.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.service.saveDocumentConfiguration(payload, this.logo())
      .pipe(
        switchMap((guardada) => this.service.publishDocumentConfiguration(guardada.id_configuracion)),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.guardando.set(false)),
      )
      .subscribe({
        next: (publicada) => {
          this.aplicarConfiguracion(publicada);
          this.logo.set(null);
          this.successMessage.set(`Configuración versión ${publicada.version} guardada y publicada.`);
        },
        error: (error: unknown) => this.errorMessage.set(
          getApiErrorMessage(error, 'No fue posible guardar la configuración.'),
        ),
      });
  }

  private aplicarConfiguracion(configuracion: ConfiguracionDocumentoResponseDto): void {
    const values: ConfiguracionDocumentoInputDto = {
      nombre_comercial: configuracion.nombre_comercial,
      nit: configuracion.nit ?? '',
      direccion: configuracion.direccion ?? '',
      telefono: configuracion.telefono ?? '',
      correo: configuracion.correo ?? '',
      terminos_cotizacion: configuracion.terminos_cotizacion ?? '',
      terminos_proforma: configuracion.terminos_proforma ?? '',
      mensaje_final: configuracion.mensaje_final ?? '',
    };
    this.form.reset(values);
    this.valores.set(values);
    this.version.set(configuracion.version);
    this.estado.set(configuracion.estado);
    this.liberarLogoTemporal();
    this.logoPreview.set(configuracion.logo_url ? `${API_BASE_URL}${configuracion.logo_url}` : null);
  }

  private empresaPreview(tipo: TipoDocumentoComercial): DatosEmpresaDocumento {
    const values = this.valores();
    const terminos = tipo === 'PROFORMA' ? values.terminos_proforma : values.terminos_cotizacion;
    return {
      logoUrl: this.logoPreview(),
      nombreComercial: values.nombre_comercial || null,
      nit: values.nit || null,
      direccion: values.direccion || null,
      telefono: values.telefono || null,
      correo: values.correo || null,
      informacionInstitucional: null,
      firmaUrl: null,
      nombreFirmante: null,
      cargoFirmante: null,
      terminosCondiciones: terminos.split(/\r?\n/).filter((linea) => linea.trim()),
      mensajeFinal: values.mensaje_final || null,
    };
  }

  private rechazarLogo(input: HTMLInputElement, mensaje: string): void {
    input.value = '';
    this.errorMessage.set(mensaje);
  }

  private liberarLogoTemporal(): void {
    const preview = this.logoPreview();
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
  }
}
