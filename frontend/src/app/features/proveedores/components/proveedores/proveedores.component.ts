import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  Departamento,
  EstadoProveedor,
  Municipio,
  Proveedor,
  ProveedorPayload,
} from '../../models/proveedor.models';
import { ProveedoresService } from '../../services/proveedores.service';

type Notice = { title: string; message: string };

@Component({
  selector: 'app-proveedores',
  imports: [ReactiveFormsModule],
  templateUrl: './proveedores.component.html',
  styleUrl: './proveedores.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly proveedoresService = inject(ProveedoresService);

  readonly proveedores = signal<Proveedor[]>([]);
  readonly departamentos = signal<Departamento[]>([]);
  readonly municipios = signal<Municipio[]>([]);
  readonly searchTerm = signal('');
  readonly isLoading = signal(false);
  readonly isLoadingMunicipios = signal(false);
  readonly isSaving = signal(false);
  readonly processingId = signal<number | null>(null);
  readonly editingProveedor = signal<Proveedor | null>(null);
  readonly selectedProveedor = signal<Proveedor | null>(null);
  readonly deleteConfirmation = signal<Proveedor | null>(null);
  readonly isFormOpen = signal(false);
  readonly submitted = signal(false);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);

  readonly form = this.formBuilder.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(150)]],
    nit: ['', Validators.maxLength(20)],
    contacto: ['', Validators.maxLength(150)],
    telefono: ['', Validators.maxLength(20)],
    correo: ['', [Validators.email, Validators.maxLength(150)]],
    id_departamento: [0, [Validators.required, Validators.min(1)]],
    id_municipio: [0, [Validators.required, Validators.min(1)]],
    direccion: [''],
    estado: ['Activo' as EstadoProveedor, Validators.required],
    observaciones: [''],
  });

  /** Busca en todos los datos visibles sin distinguir mayúsculas ni tildes. */
  readonly filteredProveedores = computed(() => {
    const query = this.normalize(this.searchTerm());
    if (!query) {
      return this.proveedores();
    }
    return this.proveedores().filter((proveedor) =>
      this.normalize(
        [
          proveedor.id_proveedor,
          proveedor.nombre,
          proveedor.nit,
          proveedor.contacto,
          proveedor.telefono,
          proveedor.correo,
          proveedor.estado,
        ].join(' '),
      ).includes(query),
    );
  });

  ngOnInit(): void {
    this.form.controls.id_municipio.disable();
    this.loadProveedores();
    this.loadDepartamentos();
  }

  /** Carga el listado y presenta errores dentro de la pantalla. */
  loadProveedores(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.proveedoresService
      .getAll()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (proveedores) => this.proveedores.set(proveedores),
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los proveedores.')),
      });
  }

  /** Carga una sola vez el catálogo compartido de departamentos. */
  loadDepartamentos(): void {
    this.proveedoresService.getDepartamentos().subscribe({
      next: (departamentos) => this.departamentos.set(departamentos),
      error: (error: unknown) =>
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los departamentos.')),
    });
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  onDepartmentChange(): void {
    this.loadMunicipios(this.form.controls.id_departamento.value);
  }

  /** Reinicia el municipio y carga solo las opciones del departamento elegido. */
  loadMunicipios(idDepartamento: number, selectedMunicipio = 0): void {
    this.municipios.set([]);
    this.form.controls.id_municipio.reset(0);
    this.form.controls.id_municipio.disable();
    if (!idDepartamento) {
      return;
    }
    this.isLoadingMunicipios.set(true);
    this.proveedoresService
      .getMunicipios(idDepartamento)
      .pipe(finalize(() => this.isLoadingMunicipios.set(false)))
      .subscribe({
        next: (municipios) => {
          this.municipios.set(municipios);
          this.form.controls.id_municipio.enable();
          this.form.controls.id_municipio.setValue(selectedMunicipio);
        },
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los municipios.')),
      });
  }

  openCreate(): void {
    this.editingProveedor.set(null);
    this.resetForm();
    this.isFormOpen.set(true);
  }

  /** Recupera el registro y deriva el departamento desde su municipio. */
  openEdit(proveedor: Proveedor): void {
    if (this.processingId()) {
      return;
    }
    this.processingId.set(proveedor.id_proveedor);
    this.errorMessage.set('');
    this.proveedoresService
      .getById(proveedor.id_proveedor)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: (current) => {
          this.editingProveedor.set(current);
          this.form.reset({
            nombre: current.nombre,
            nit: current.nit ?? '',
            contacto: current.contacto ?? '',
            telefono: current.telefono ?? '',
            correo: current.correo ?? '',
            id_departamento: current.municipio.id_departamento,
            id_municipio: 0,
            direccion: current.direccion ?? '',
            estado: current.estado,
            observaciones: current.observaciones ?? '',
          });
          this.loadMunicipios(current.municipio.id_departamento, current.id_municipio);
          this.submitted.set(false);
          this.isFormOpen.set(true);
        },
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar el proveedor.')),
      });
  }

  closeForm(): void {
    if (!this.isSaving()) {
      this.isFormOpen.set(false);
      this.editingProveedor.set(null);
      this.errorMessage.set('');
    }
  }

  /** Valida y envía únicamente los campos reales aceptados por FastAPI. */
  saveProveedor(): void {
    if (this.isSaving()) {
      return;
    }
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    if (this.form.invalid || !raw.id_municipio || !raw.nombre.trim()) {
      this.errorMessage.set('Revisa el nombre, correo, departamento y municipio del formulario.');
      return;
    }

    const payload: ProveedorPayload = {
      nombre: raw.nombre.trim(),
      nit: this.optionalText(raw.nit),
      contacto: this.optionalText(raw.contacto),
      telefono: this.optionalText(raw.telefono),
      correo: this.optionalText(raw.correo),
      direccion: this.optionalText(raw.direccion),
      id_municipio: raw.id_municipio,
      estado: raw.estado,
      observaciones: this.optionalText(raw.observaciones),
    };
    const editing = this.editingProveedor();
    const request = editing
      ? this.proveedoresService.update(editing.id_proveedor, payload)
      : this.proveedoresService.create(payload);

    this.isSaving.set(true);
    this.errorMessage.set('');
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (saved) => {
        this.proveedores.update((items) =>
          editing
            ? items.map((item) => (item.id_proveedor === saved.id_proveedor ? saved : item))
            : [saved, ...items],
        );
        this.isFormOpen.set(false);
        this.editingProveedor.set(null);
        this.notice.set({
          title: editing ? 'Proveedor actualizado' : 'Proveedor registrado',
          message: editing
            ? 'La información del proveedor se actualizó correctamente.'
            : 'El proveedor se registró correctamente.',
        });
      },
      error: (error: unknown) =>
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible guardar el proveedor.')),
    });
  }

  openDetails(proveedor: Proveedor): void {
    this.selectedProveedor.set(proveedor);
  }

  /** Resuelve el nombre del departamento con el catálogo ya cargado. */
  departamentoNombre(idDepartamento: number): string {
    return (
      this.departamentos().find(
        (departamento) => departamento.id_departamento === idDepartamento,
      )?.nombre ?? `ID ${idDepartamento}`
    );
  }

  requestDelete(proveedor: Proveedor): void {
    this.errorMessage.set('');
    this.deleteConfirmation.set(proveedor);
  }

  /** Elimina y, ante relaciones, conserva el mensaje del backend que ofrece inactivar. */
  confirmDelete(): void {
    const proveedor = this.deleteConfirmation();
    if (!proveedor || this.processingId()) {
      return;
    }
    this.processingId.set(proveedor.id_proveedor);
    this.proveedoresService
      .delete(proveedor.id_proveedor)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: () => {
          this.proveedores.update((items) =>
            items.filter((item) => item.id_proveedor !== proveedor.id_proveedor),
          );
          this.deleteConfirmation.set(null);
          this.notice.set({
            title: 'Proveedor eliminado',
            message: 'El proveedor se eliminó correctamente.',
          });
        },
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible eliminar el proveedor.')),
      });
  }

  /** Alterna el estado mediante el endpoint específico sin abrir el formulario. */
  toggleEstado(proveedor: Proveedor): void {
    if (this.processingId()) {
      return;
    }
    const estado: EstadoProveedor = proveedor.estado === 'Activo' ? 'Inactivo' : 'Activo';
    this.processingId.set(proveedor.id_proveedor);
    this.errorMessage.set('');
    this.proveedoresService
      .setEstado(proveedor.id_proveedor, estado)
      .pipe(finalize(() => this.processingId.set(null)))
      .subscribe({
        next: (updated) => {
          this.proveedores.update((items) =>
            items.map((item) => (item.id_proveedor === updated.id_proveedor ? updated : item)),
          );
          this.notice.set({
            title: `Proveedor ${estado.toLowerCase()}`,
            message: `El proveedor quedó ${estado.toLowerCase()} correctamente.`,
          });
        },
        error: (error: unknown) =>
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cambiar el estado.')),
      });
  }

  private resetForm(): void {
    this.form.reset({
      nombre: '',
      nit: '',
      contacto: '',
      telefono: '',
      correo: '',
      id_departamento: 0,
      id_municipio: 0,
      direccion: '',
      estado: 'Activo',
      observaciones: '',
    });
    this.form.controls.id_municipio.disable();
    this.municipios.set([]);
    this.submitted.set(false);
    this.errorMessage.set('');
  }

  private optionalText(value: string): string | null {
    return value.trim() || null;
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
