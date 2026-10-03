// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, of, switchMap } from 'rxjs';

import { API_BASE_URL } from '../../core/config/api.config';
import { getApiErrorMessage } from '../../core/utils/api-error';
import { Departamento, Municipio } from '../../core/models/cliente.models';
import { Empleado, EmpleadoUpdate, PuestoEmpleado } from '../../core/models/empleado.models';
import { EmpleadosService } from '../../core/services/empleados.service';

// ==========================================
// TIPOS VISUALES DE EMPLEADOS
// ==========================================
type EmployeeStatus = 'Activo' | 'Inactivo';
type InstallationStatus = 'all' | 'active' | 'inactive';
type Notice = { title: string; message: string };

interface EmployeeRow {
  detail: Empleado;
  codigo: string;
  nombres: string;
  apellidos: string;
  correo: string | null;
  telefono_principal: string;
  puesto: string;
  fecha_ingreso: string;
  estado: EmployeeStatus;
}

// ==========================================
// COMPONENTE DE GESTION DE EMPLEADOS
// ==========================================
@Component({
  selector: 'app-empleados',
  imports: [ReactiveFormsModule],
  templateUrl: './empleados.component.html',
  styleUrl: './empleados.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpleadosComponent implements OnInit, OnDestroy {
  // ==========================================
  // DEPENDENCIAS Y ESTADO DE LA VISTA
  // ==========================================
  private readonly formBuilder = inject(FormBuilder);
  private readonly empleadosService = inject(EmpleadosService);

  readonly employees = signal<EmployeeRow[]>([]);
  readonly puestos = signal<PuestoEmpleado[]>([]);
  readonly departamentos = signal<Departamento[]>([]);
  readonly municipios = signal<Municipio[]>([]);
  readonly isModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly editingEmployee = signal<Empleado | null>(null);
  readonly selectedEmployee = signal<Empleado | null>(null);
  readonly isLoadingMunicipios = signal(false);
  readonly isLoadingEmployee = signal<number | null>(null);
  readonly isDeleting = signal<number | null>(null);
  readonly isSaving = signal(false);
  readonly profilePhotoUrl = signal<string | null>(null);
  readonly profilePhotoFile = signal<File | null>(null);
  readonly originalProfilePhotoUrl = signal<string | null>(null);
  readonly photoRemovalRequested = signal(false);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);
  readonly deleteConfirmation = signal<Empleado | null>(null);
  readonly submitted = signal(false);
  readonly searchTerm = signal('');
  readonly positionFilter = signal('all');
  readonly statusFilter = signal<InstallationStatus>('all');

  // ==========================================
  // FORMULARIO VISUAL DE EMPLEADO
  // ==========================================
  readonly form = this.formBuilder.nonNullable.group({
    codigo: [{ value: 'EMP-0005', disabled: true }],
    nombres: ['', [Validators.required, Validators.maxLength(150)]],
    apellidos: ['', [Validators.required, Validators.maxLength(150)]],
    id_puesto: [0, [Validators.required, Validators.min(1)]],
    tipo_documento: ['DPI', Validators.required],
    numero_documento: ['', [Validators.required, Validators.maxLength(30)]],
    telefono_principal: ['', [Validators.required, Validators.maxLength(30)]],
    telefono_alternativo: ['', Validators.maxLength(30)],
    correo: ['', Validators.email],
    id_departamento: [0, [Validators.required, Validators.min(1)]],
    id_municipio: [0, [Validators.required, Validators.min(1)]],
    fecha_ingreso: ['', Validators.required],
    direccion: ['', [Validators.required, Validators.maxLength(300)]],
    estado: ['Activo' as EmployeeStatus, Validators.required],
    observaciones: [''],
  });

  // ==========================================
  // FILTROS DE EMPLEADOS
  // ==========================================
  readonly filteredEmployees = computed(() => {
    const query = this.normalize(this.searchTerm());
    const position = this.positionFilter();
    const status = this.statusFilter();

    return this.employees().filter((employee) => {
      const matchesPosition = position === 'all' || employee.puesto === position;
      const matchesStatus =
        status === 'all' ||
        (status === 'active' && employee.estado === 'Activo') ||
        (status === 'inactive' && employee.estado === 'Inactivo');
      const searchableText = this.normalize(
        [employee.codigo, employee.nombres, employee.apellidos, employee.telefono_principal].join(
          ' ',
        ),
      );

      return matchesPosition && matchesStatus && searchableText.includes(query);
    });
  });

  private profilePhotoObjectUrl: string | null = null;

  // ==========================================
  // CARGA DE CATALOGOS GEOGRAFICOS
  // ==========================================
  ngOnInit(): void {
    this.form.controls.id_municipio.disable();
    this.loadEmployees();
    this.loadPositions();
  }

  ngOnDestroy(): void {
    this.resetPhotoState();
  }

  loadDepartments(): void {
    this.empleadosService.getDepartamentos().subscribe({
      next: (departamentos) => this.departamentos.set(departamentos),
      error: (error: unknown) => console.error('No fue posible cargar departamentos.', error),
    });
  }

  loadEmployees(): void {
    this.empleadosService.getAll().subscribe({
      next: (employees) =>
        this.employees.set(employees.map((employee) => this.toEmployeeRow(employee))),
      error: (error: unknown) => console.error('No fue posible cargar empleados.', error),
    });
  }

  loadPositions(): void {
    this.empleadosService.getPuestos().subscribe({
      next: (puestos) => this.puestos.set(puestos),
      error: (error: unknown) => console.error('No fue posible cargar puestos.', error),
    });
  }

  onDepartmentChange(): void {
    this.loadMunicipios(this.form.controls.id_departamento.value);
  }

  loadMunicipios(idDepartamento: number, selectedMunicipio = 0): void {
    this.municipios.set([]);
    this.form.controls.id_municipio.reset(0);
    this.form.controls.id_municipio.disable();
    if (!idDepartamento) {
      return;
    }

    this.isLoadingMunicipios.set(true);
    this.empleadosService.getMunicipios(idDepartamento).subscribe({
      next: (municipios) => {
        this.municipios.set(municipios);
        this.form.controls.id_municipio.enable();
        this.form.controls.id_municipio.setValue(selectedMunicipio);
      },
      complete: () => this.isLoadingMunicipios.set(false),
      error: () => this.isLoadingMunicipios.set(false),
    });
  }

  // ==========================================
  // MODAL DE NUEVO EMPLEADO
  // ==========================================
  openCreate(): void {
    if (!this.departamentos().length) {
      this.loadDepartments();
    }
    this.editingEmployee.set(null);
    this.isEditModalOpen.set(false);
    this.form.reset({
      codigo: { value: 'EMP-0005', disabled: true },
      nombres: '',
      apellidos: '',
      id_puesto: 0,
      tipo_documento: 'DPI',
      numero_documento: '',
      telefono_principal: '',
      telefono_alternativo: '',
      correo: '',
      id_departamento: 0,
      id_municipio: 0,
      fecha_ingreso: '',
      direccion: '',
      estado: 'Activo',
      observaciones: '',
    });
    this.resetPhotoState();
    this.errorMessage.set('');
    this.submitted.set(false);
    this.municipios.set([]);
    this.form.controls.id_municipio.disable();
    this.isModalOpen.set(true);
  }

  openEdit(employee: Empleado): void {
    if (this.isSaving() || this.isLoadingEmployee()) {
      return;
    }
    if (!this.departamentos().length) {
      this.loadDepartments();
    }

    this.errorMessage.set('');
    this.submitted.set(false);
    this.isLoadingEmployee.set(employee.id_empleado);
    this.empleadosService
      .getById(employee.id_empleado)
      .pipe(finalize(() => this.isLoadingEmployee.set(null)))
      .subscribe({
        next: (currentEmployee) => {
          this.editingEmployee.set(currentEmployee);
          this.form.reset({
            codigo: { value: currentEmployee.codigo, disabled: true },
            nombres: currentEmployee.nombres,
            apellidos: currentEmployee.apellidos,
            id_puesto: currentEmployee.id_puesto,
            tipo_documento: currentEmployee.tipo_documento,
            numero_documento: currentEmployee.numero_documento,
            telefono_principal: currentEmployee.telefono_principal,
            telefono_alternativo: currentEmployee.telefono_alternativo ?? '',
            correo: currentEmployee.correo ?? '',
            id_departamento: currentEmployee.id_departamento,
            id_municipio: 0,
            fecha_ingreso: currentEmployee.fecha_ingreso,
            direccion: currentEmployee.direccion,
            estado: currentEmployee.estado,
            observaciones: currentEmployee.observaciones ?? '',
          });
          this.setExistingProfilePhoto(currentEmployee.foto_perfil);
          this.loadMunicipios(currentEmployee.id_departamento, currentEmployee.id_municipio);
          this.isModalOpen.set(false);
          this.isEditModalOpen.set(true);
        },
        error: (error: unknown) => {
          console.error('No fue posible cargar el empleado.', error);
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar el empleado.'));
        },
      });
  }

  closeModal(): void {
    if (!this.isSaving()) {
      this.isModalOpen.set(false);
      this.isEditModalOpen.set(false);
      this.editingEmployee.set(null);
      this.resetPhotoState();
    }
  }

  openDetails(employee: Empleado): void {
    this.selectedEmployee.set(employee);
  }

  closeDetails(): void {
    this.selectedEmployee.set(null);
  }

  requestDelete(employee: Empleado): void {
    if (employee.estado === 'Inactivo' || this.isDeleting()) {
      return;
    }
    this.errorMessage.set('');
    this.deleteConfirmation.set(employee);
  }

  cancelDelete(): void {
    if (!this.isDeleting()) {
      this.deleteConfirmation.set(null);
      this.errorMessage.set('');
    }
  }

  confirmDelete(): void {
    const employee = this.deleteConfirmation();
    if (!employee || employee.estado === 'Inactivo' || this.isDeleting()) {
      return;
    }

    this.errorMessage.set('');
    this.isDeleting.set(employee.id_empleado);
    this.empleadosService
      .delete(employee.id_empleado)
      .pipe(finalize(() => this.isDeleting.set(null)))
      .subscribe({
        next: (updatedEmployee) => {
          this.employees.update((employees) =>
            employees.map((item) =>
              item.detail.id_empleado === updatedEmployee.id_empleado
                ? this.toEmployeeRow(updatedEmployee)
                : item,
            ),
          );
          this.deleteConfirmation.set(null);
          this.notice.set({
            title: 'Empleado eliminado correctamente',
            message: 'El empleado fue desactivado y su información se conservará en el sistema.',
          });
        },
        error: (error: unknown) => {
          console.error('No fue posible eliminar el empleado.', error);
          this.errorMessage.set(this.getDeleteErrorMessage(error));
        },
      });
  }

  photoUrl(photoPath: string | null): string {
    return photoPath?.startsWith('http') ? photoPath : `${API_BASE_URL}${photoPath ?? ''}`;
  }

  onProfilePhotoSelected(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.item(0);
    if (!file) {
      return;
    }

    this.revokeProfilePhotoObjectUrl();
    this.profilePhotoFile.set(file);
    this.profilePhotoObjectUrl = URL.createObjectURL(file);
    this.profilePhotoUrl.set(this.profilePhotoObjectUrl);
    this.photoRemovalRequested.set(false);
    input.value = '';
  }

  removeProfilePhoto(): void {
    if (this.profilePhotoFile()) {
      this.revokeProfilePhotoObjectUrl();
      this.profilePhotoFile.set(null);
      this.profilePhotoUrl.set(this.originalProfilePhotoUrl());
      return;
    }

    if (this.originalProfilePhotoUrl()) {
      this.photoRemovalRequested.set(true);
    }
    this.profilePhotoUrl.set(null);
  }

  private revokeProfilePhotoObjectUrl(): void {
    if (this.profilePhotoObjectUrl) {
      URL.revokeObjectURL(this.profilePhotoObjectUrl);
      this.profilePhotoObjectUrl = null;
    }
  }

  private resetPhotoState(): void {
    this.revokeProfilePhotoObjectUrl();
    this.profilePhotoUrl.set(null);
    this.profilePhotoFile.set(null);
    this.originalProfilePhotoUrl.set(null);
    this.photoRemovalRequested.set(false);
  }

  private setExistingProfilePhoto(photoPath: string | null): void {
    this.revokeProfilePhotoObjectUrl();
    const photoUrl = photoPath ? this.photoUrl(photoPath) : null;
    this.originalProfilePhotoUrl.set(photoUrl);
    this.profilePhotoUrl.set(photoUrl);
    this.profilePhotoFile.set(null);
    this.photoRemovalRequested.set(false);
  }

  saveEmployee(): void {
    if (this.isSaving()) {
      return;
    }

    this.submitted.set(true);
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    if (!raw.id_municipio || this.form.invalid) {
      const message = !raw.id_municipio
        ? 'Selecciona un municipio.'
        : 'Revisa los campos obligatorios del formulario.';
      console.warn('Empleado no enviado: formulario inválido.', this.form.errors, raw);
      this.errorMessage.set(message);
      return;
    }

    const editingEmployee = this.editingEmployee();
    this.isSaving.set(true);
    const saveRequest = editingEmployee
      ? this.updateExistingEmployee(editingEmployee.id_empleado, raw)
      : this.createNewEmployee(raw);

    saveRequest.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (savedEmployee) => {
        this.employees.update((employees) =>
          editingEmployee
            ? employees.map((employee) =>
                employee.detail.id_empleado === savedEmployee.id_empleado
                  ? this.toEmployeeRow(savedEmployee)
                  : employee,
              )
            : [this.toEmployeeRow(savedEmployee), ...employees],
        );
        this.resetEmployeeForm();
        this.isModalOpen.set(false);
        this.isEditModalOpen.set(false);
        this.editingEmployee.set(null);
        this.notice.set({
          title: editingEmployee
            ? 'Empleado actualizado correctamente'
            : 'Empleado creado correctamente',
          message: editingEmployee
            ? 'La información del empleado se ha actualizado con éxito.'
            : 'La información del empleado se ha registrado con éxito.',
        });
      },
      error: (error: unknown) => {
        console.error('No fue posible guardar los cambios del empleado.', error);
        this.errorMessage.set(
          getApiErrorMessage(error, 'No fue posible guardar los cambios del empleado.'),
        );
      },
    });
  }

  private createNewEmployee(raw: ReturnType<typeof this.form.getRawValue>) {
    const formData = new FormData();
    formData.append('id_puesto', String(raw.id_puesto));
    formData.append('id_municipio', String(raw.id_municipio));
    formData.append('nombres', raw.nombres.trim());
    formData.append('apellidos', raw.apellidos.trim());
    formData.append('tipo_documento', raw.tipo_documento);
    formData.append('numero_documento', raw.numero_documento.trim());
    formData.append('telefono_principal', raw.telefono_principal.trim());
    this.appendOptional(formData, 'telefono_alternativo', raw.telefono_alternativo);
    this.appendOptional(formData, 'correo', raw.correo);
    formData.append('direccion', raw.direccion.trim());
    formData.append('fecha_ingreso', raw.fecha_ingreso);
    formData.append('estado', raw.estado);
    this.appendOptional(formData, 'observaciones', raw.observaciones);

    const photo = this.profilePhotoFile();
    if (photo) {
      formData.append('foto', photo, photo.name);
    }

    return this.empleadosService.create(formData);
  }

  private updateExistingEmployee(
    idEmpleado: number,
    raw: ReturnType<typeof this.form.getRawValue>,
  ) {
    const payload: EmpleadoUpdate = {
      id_puesto: raw.id_puesto,
      id_municipio: raw.id_municipio,
      nombres: raw.nombres.trim(),
      apellidos: raw.apellidos.trim(),
      tipo_documento: raw.tipo_documento,
      numero_documento: raw.numero_documento.trim(),
      telefono_principal: raw.telefono_principal.trim(),
      telefono_alternativo: this.toNullableText(raw.telefono_alternativo),
      correo: this.toNullableText(raw.correo),
      direccion: raw.direccion.trim(),
      fecha_ingreso: raw.fecha_ingreso,
      estado: raw.estado,
      observaciones: this.toNullableText(raw.observaciones),
    };

    return this.empleadosService.update(idEmpleado, payload).pipe(
      switchMap((savedEmployee) => {
        const photo = this.profilePhotoFile();
        if (photo) {
          return this.empleadosService.replacePhoto(idEmpleado, photo);
        }
        if (this.photoRemovalRequested()) {
          return this.empleadosService.removePhoto(idEmpleado);
        }
        return of(savedEmployee);
      }),
    );
  }

  private resetEmployeeForm(): void {
    this.form.reset({
      codigo: { value: 'EMP-0005', disabled: true },
      nombres: '',
      apellidos: '',
      id_puesto: 0,
      tipo_documento: 'DPI',
      numero_documento: '',
      telefono_principal: '',
      telefono_alternativo: '',
      correo: '',
      id_departamento: 0,
      id_municipio: 0,
      fecha_ingreso: '',
      direccion: '',
      estado: 'Activo',
      observaciones: '',
    });
    this.municipios.set([]);
    this.form.controls.id_municipio.disable();
    this.resetPhotoState();
    this.errorMessage.set('');
    this.submitted.set(false);
  }

  clearNotice(): void {
    this.notice.set(null);
  }

  private appendOptional(formData: FormData, name: string, value: string): void {
    const normalized = value.trim();
    if (normalized) {
      formData.append(name, normalized);
    }
  }

  private toNullableText(value: string): string | null {
    const normalized = value.trim();
    return normalized || null;
  }

  private getDeleteErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return 'Empleado no encontrado.';
      }
      if (error.status === 403) {
        return 'No tiene permisos para realizar esta acción.';
      }
      if (error.status >= 500) {
        return 'No se pudo eliminar el empleado.';
      }
    }
    return getApiErrorMessage(error, 'No se pudo eliminar el empleado.');
  }

  private toEmployeeRow(employee: Empleado): EmployeeRow {
    return {
      detail: employee,
      codigo: employee.codigo,
      nombres: employee.nombres,
      apellidos: employee.apellidos,
      correo: employee.correo,
      telefono_principal: employee.telefono_principal,
      puesto: employee.nombre_puesto,
      fecha_ingreso: employee.fecha_ingreso,
      estado: employee.estado,
    };
  }

  // ==========================================
  // FILTROS Y BUSQUEDA
  // ==========================================
  onPositionFilterChange(event: Event): void {
    const value = this.getFilterValue(event);
    if (value !== null) {
      this.positionFilter.set(value);
    }
  }

  onStatusFilterChange(event: Event): void {
    const value = this.getFilterValue(event);
    if (value === 'all' || value === 'active' || value === 'inactive') {
      this.statusFilter.set(value);
    }
  }

  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private getFilterValue(event: Event): string | null {
    const select = event.target;
    return select instanceof HTMLSelectElement ? select.value : null;
  }
}
