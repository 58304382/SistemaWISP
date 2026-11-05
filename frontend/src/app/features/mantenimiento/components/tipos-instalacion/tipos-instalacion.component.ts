// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CATALOGOS, CatalogoClave, CatalogoPayload, RegistroCatalogo } from '../../models/catalogos.models';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  EstadoTipoInstalacion,
  TipoInstalacionUpdate,
} from '../../models/tipo-instalacion-catalogo.models';
import { TiposInstalacionCatalogoService } from '../../services/tipos-instalacion-catalogo.service';

type ModoModal = 'ver' | 'crear' | 'editar';

interface Notice {
  title: string;
  message: string;
}

// ==========================================
// COMPONENTE DEL CATALOGO DE TIPOS DE INSTALACION
// ==========================================
@Component({
  selector: 'app-tipos-instalacion',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './tipos-instalacion.component.html',
  styleUrl: './tipos-instalacion.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TiposInstalacionComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly tiposService = inject(TiposInstalacionCatalogoService);
  private readonly destroyRef = inject(DestroyRef);

  // El editor existente también funciona como panel de los otros cinco catálogos.
  readonly catalogo = input<CatalogoClave>('instalacion');
  readonly embebido = input(false);
  readonly ocupado = output<boolean>();
  readonly config = computed(() => CATALOGOS.find((item) => item.clave === this.catalogo())!);
  readonly columnas = computed(() => this.catalogo() === 'caja' ? 6 : this.catalogo() === 'puestos' ? 5 : 4);
  readonly nombreMax = computed(() => ['pagos', 'caja'].includes(this.catalogo()) ? null : 100);
  readonly descripcionMax = computed(() => this.catalogo() === 'instalacion' ? 250 : null);
  readonly protegido = computed(() => {
    const item = this.seleccionado();
    if (!item) return false;
    const nombre = this.normalizar(item.nombre);
    return (this.catalogo() === 'pagos' && nombre === 'efectivo') ||
      (this.catalogo() === 'puestos' && nombre === 'tecnico') ||
      (this.catalogo() === 'caja' && !!item.origen_financiero);
  });
  readonly nombreProtegido = computed(() => this.protegido() || (
    this.catalogo() === 'caja' && ['entrada', 'salida'].includes(this.normalizar(this.seleccionado()?.nombre ?? ''))
  ));

  readonly tipos = signal<RegistroCatalogo[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly procesandoId = signal<number | null>(null);
  readonly modalAbierto = signal(false);
  readonly modo = signal<ModoModal>('crear');
  readonly seleccionado = signal<RegistroCatalogo | null>(null);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);
  readonly totalActivos = computed(
    () => this.tipos().filter((tipo) => tipo.estado === 'Activo').length,
  );
  readonly form = this.formBuilder.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(100)]],
    descripcion: ['', Validators.maxLength(250)],
    estado: ['Activo' as EstadoTipoInstalacion, Validators.required],
    tipo: ['Ingreso' as 'Ingreso' | 'Egreso', Validators.required],
    tiene_funciones_sistema: [false],
  });

  constructor() {
    // Evita cambiar de panel mientras hay un modal abierto o una escritura pendiente.
    effect(() => this.ocupado.emit(this.modalAbierto() || this.guardando() || this.procesandoId() !== null));
  }

  ngOnInit(): void {
    this.form.controls.nombre.setValidators(this.nombreMax() === null ? [Validators.required] : [Validators.required, Validators.maxLength(100)]);
    this.form.controls.descripcion.setValidators(this.descripcionMax() === null ? [] : [Validators.maxLength(250)]);
    this.cargarTipos();
  }

  /** Carga activos e inactivos para poder administrar el catálogo completo. */
  cargarTipos(): void {
    this.cargando.set(true);
    this.errorMessage.set('');
    const solicitud = this.catalogo() === 'instalacion' ? this.tiposService.getAll() : this.tiposService.getCatalogo(this.catalogo());
    solicitud
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (tipos) => this.tipos.set(tipos),
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible cargar el catálogo.'),
          ),
      });
  }

  abrirNuevo(): void {
    if (this.guardando() || this.procesandoId() !== null) return;
    this.seleccionado.set(null);
    this.modo.set('crear');
    this.resetForm();
    this.errorMessage.set('');
    this.modalAbierto.set(true);
  }

  abrirVer(tipo: RegistroCatalogo): void {
    if (this.guardando() || this.procesandoId() !== null) return;
    this.seleccionado.set(tipo);
    this.modo.set('ver');
    this.errorMessage.set('');
    this.modalAbierto.set(true);
  }

  editarSeleccionado(): void {
    const tipo = this.seleccionado();
    if (tipo !== null) {
      this.abrirEditar(tipo);
    }
  }

  abrirEditar(tipo: RegistroCatalogo): void {
    if (this.guardando() || this.procesandoId() !== null) return;
    this.seleccionado.set(tipo);
    this.modo.set('editar');
    this.form.reset({
      nombre: tipo.nombre,
      descripcion: tipo.descripcion ?? '',
      estado: tipo.estado,
      tipo: tipo.tipo ?? 'Ingreso',
      tiene_funciones_sistema: tipo.tiene_funciones_sistema ?? false,
    });
    // Los campos protegidos conservan su valor al serializar getRawValue().
    this.form.controls.estado.enable();
    this.form.controls.tipo.enable();
    this.form.controls.tiene_funciones_sistema.enable();
    if (this.protegido()) {
      this.form.controls.estado.disable();
      this.form.controls.tiene_funciones_sistema.disable();
    }
    if (this.nombreProtegido()) this.form.controls.tipo.disable();
    this.errorMessage.set('');
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    if (this.guardando()) {
      return;
    }
    this.modalAbierto.set(false);
    this.seleccionado.set(null);
    this.errorMessage.set('');
  }

  /** Crea o actualiza reutilizando los mismos campos reales del catálogo. */
  guardar(): void {
    if (this.guardando() || this.modo() === 'ver') {
      return;
    }
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    if (this.form.invalid || !raw.nombre.trim()) {
      this.errorMessage.set('Revise el nombre, la descripción y los campos del catálogo.');
      return;
    }

    const payload: CatalogoPayload = {
      nombre: raw.nombre.trim(),
      descripcion: raw.descripcion.trim() || null,
      estado: raw.estado,
    };
    if (this.catalogo() === 'caja') payload.tipo = raw.tipo;
    if (this.catalogo() === 'puestos') payload.tiene_funciones_sistema = raw.tiene_funciones_sistema;
    const editando = this.modo() === 'editar' ? this.seleccionado() : null;
    const solicitud = this.catalogo() === 'instalacion'
      ? (editando ? this.tiposService.update(editando.id_tipo_instalacion, payload) : this.tiposService.create(payload))
      : this.tiposService.guardarCatalogo(this.catalogo(), payload, editando?.id_tipo_instalacion);

    this.guardando.set(true);
    this.errorMessage.set('');
    solicitud.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.guardando.set(false))).subscribe({
      next: (guardado) => {
        this.reemplazarEnLista(guardado);
        this.modalAbierto.set(false);
        this.seleccionado.set(null);
        this.notice.set({
          title: this.catalogo() === 'instalacion'
            ? (editando ? 'Tipo de instalación actualizado' : 'Tipo de instalación registrado')
            : (editando ? 'Registro actualizado' : 'Registro creado'),
          message: editando
            ? 'Los datos del catálogo se actualizaron correctamente.'
            : 'El nuevo tipo de instalación se registró correctamente.',
        });
      },
      error: (error: unknown) =>
        this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible guardar el registro.'),
        ),
    });
  }

  /** Activa o inactiva sin eliminar; el backend rechaza inactivar si está en uso. */
  alternarEstado(tipo: RegistroCatalogo): void {
    if (this.procesandoId() !== null || this.guardando() || this.modalAbierto() || this.estadoProtegido(tipo)) {
      return;
    }
    const estado: EstadoTipoInstalacion = tipo.estado === 'Activo' ? 'Inactivo' : 'Activo';
    const payload: TipoInstalacionUpdate = { estado };
    this.procesandoId.set(tipo.id_tipo_instalacion);
    this.errorMessage.set('');
    const completo: CatalogoPayload = { nombre: tipo.nombre, descripcion: tipo.descripcion, estado };
    if (this.catalogo() === 'caja') completo.tipo = tipo.tipo;
    if (this.catalogo() === 'puestos') completo.tiene_funciones_sistema = tipo.tiene_funciones_sistema;
    const solicitud = this.catalogo() === 'instalacion'
      ? this.tiposService.update(tipo.id_tipo_instalacion, payload)
      : this.tiposService.guardarCatalogo(this.catalogo(), completo, tipo.id_tipo_instalacion);
    solicitud
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.procesandoId.set(null)))
      .subscribe({
        next: (actualizado) => {
          this.reemplazarEnLista(actualizado);
          this.notice.set({
            title: 'Estado actualizado',
            message: `El registro quedó ${estado.toLowerCase()} correctamente.`,
          });
        },
        error: (error: unknown) =>
          this.errorMessage.set(
            getApiErrorMessage(error, 'No fue posible cambiar el estado del registro.'),
          ),
      });
  }

  cerrarNotice(): void {
    this.notice.set(null);
  }

  /** Mantiene la tabla ordenada por nombre después de crear o editar. */
  private reemplazarEnLista(guardado: RegistroCatalogo): void {
    this.tipos.update((items) => {
      const existe = items.some(
        (item) => item.id_tipo_instalacion === guardado.id_tipo_instalacion,
      );
      const actualizados = existe
        ? items.map((item) =>
            item.id_tipo_instalacion === guardado.id_tipo_instalacion ? guardado : item,
          )
        : [...items, guardado];
      return [...actualizados].sort((a, b) => a.nombre.localeCompare(b.nombre));
    });
  }

  private resetForm(): void {
    this.form.enable();
    this.form.reset({
      nombre: '',
      descripcion: '',
      estado: 'Activo',
      tipo: 'Ingreso',
      tiene_funciones_sistema: false,
    });
  }

  /** Protecciones visuales; FastAPI vuelve a comprobarlas para todas las peticiones. */
  estadoProtegido(item: RegistroCatalogo): boolean {
    return (this.catalogo() === 'caja' && !!item.origen_financiero) ||
      (this.catalogo() === 'pagos' && this.normalizar(item.nombre) === 'efectivo') ||
      (this.catalogo() === 'puestos' && this.normalizar(item.nombre) === 'tecnico');
  }

  private normalizar(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
}
