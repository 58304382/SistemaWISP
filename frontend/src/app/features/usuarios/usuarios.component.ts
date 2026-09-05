// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { getApiErrorMessage } from '../../core/utils/api-error';
import { AuthService } from '../../core/services/auth.service';
import { UsuariosService } from '../../core/services/usuarios.service';
import {
  Modulo,
  ROLES,
  Usuario,
  UsuarioCreate,
  UsuarioUpdate,
} from '../../core/models/usuario.models';

// ==========================================
// TIPOS Y VALIDADORES
// ==========================================
type Notice = { title: string; message: string };
type UserFilter = 'all' | 'active' | 'inactive' | 'administrator' | 'employee';

const passwordMatchValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const password = control.get('password')?.value as string;
  const confirmation = control.get('confirmPassword')?.value as string;
  return (!password && !confirmation) || password === confirmation
    ? null
    : { passwordMismatch: true };
};

const minimumModulesValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = control.value as number[];
  return Array.isArray(value) && value.length >= 2 ? null : { minModules: true };
};

// ==========================================
// COMPONENTE USUARIOS
// ==========================================
@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './usuarios.component.html',
  styleUrl: './usuarios.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosComponent implements OnInit {
  // ==========================================
  // DEPENDENCIAS Y ESTADO DE LA VISTA
  // ==========================================
  private readonly formBuilder = inject(FormBuilder);
  private readonly usuariosService = inject(UsuariosService);
  readonly auth = inject(AuthService);

  readonly users = signal<Usuario[]>([]);
  readonly searchTerm = signal('');
  readonly activeFilter = signal<UserFilter>('all');
  readonly modules = signal<Modulo[]>([]);
  readonly roles = ROLES;
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly isLoadingEdit = signal<number | null>(null);
  readonly isChangingStatus = signal<number | null>(null);
  readonly isModalOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly statusConfirmation = signal<Usuario | null>(null);
  readonly errorMessage = signal('');
  readonly notice = signal<Notice | null>(null);
  readonly submitted = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  // ==========================================
  // BUSQUEDA Y FILTROS
  // ==========================================
  readonly filteredUsers = computed(() => {
    const query = this.normalize(this.searchTerm());
    const filter = this.activeFilter();

    return this.users().filter((user) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && user.activo) ||
        (filter === 'inactive' && !user.activo) ||
        (filter === 'administrator' && this.normalize(user.rol.nombre) === 'administrador') ||
        (filter === 'employee' && this.normalize(user.rol.nombre) === 'empleado');
      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }
      const searchableText = this.normalize(
        [
          user.nombre,
          user.apellido,
          `${user.nombre} ${user.apellido}`,
          user.username,
          user.rol.nombre,
          user.activo ? 'activo' : 'inactivo',
        ].join(' '),
      );
      return searchableText.includes(query);
    });
  });

  // ==========================================
  // FORMULARIO DE USUARIO
  // ==========================================
  readonly form = this.formBuilder.nonNullable.group(
    {
      nombre: ['', [Validators.required, Validators.maxLength(150)]],
      apellido: ['', [Validators.required, Validators.maxLength(150)]],
      username: ['', [Validators.required, Validators.maxLength(100)]],
      password: ['', [Validators.minLength(8)]],
      confirmPassword: [''],
      rol_id: [2, [Validators.required, Validators.min(1)]],
      activo: [true],
      modulo_ids: this.formBuilder.nonNullable.control<number[]>([], [minimumModulesValidator]),
    },
    { validators: passwordMatchValidator },
  );

  // ==========================================
  // CARGA DE DATOS
  // ==========================================
  ngOnInit(): void {
    this.loadModules();
    this.loadUsers();
  }

  loadModules(): void {
    this.usuariosService.getModules().subscribe({
      next: (modules) => this.modules.set(modules),
      error: (error: unknown) => {
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los módulos.'));
      },
    });
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.usuariosService
      .getAll()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (users) => this.users.set(users),
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar los usuarios.'));
        },
      });
  }

  // ==========================================
  // BUSQUEDA Y FILTROS
  // ==========================================
  onSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchTerm.set(input.value);
    }
  }

  setFilter(filter: UserFilter): void {
    this.activeFilter.set(filter);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.activeFilter.set('all');
  }

  // ==========================================
  // NUEVO Y EDITAR USUARIO
  // ==========================================
  openCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      nombre: '',
      apellido: '',
      username: '',
      password: '',
      confirmPassword: '',
      rol_id: 2,
      activo: true,
      modulo_ids: [],
    });
    this.setPasswordValidators(true);
    this.resetFormState();
    this.isModalOpen.set(true);
  }

  openEdit(user: Usuario): void {
    this.errorMessage.set('');
    this.isLoadingEdit.set(user.id);
    this.usuariosService
      .getById(user.id)
      .pipe(finalize(() => this.isLoadingEdit.set(null)))
      .subscribe({
        next: (currentUser) => {
          this.editingId.set(currentUser.id);
          this.form.reset({
            nombre: currentUser.nombre,
            apellido: currentUser.apellido,
            username: currentUser.username,
            password: '',
            confirmPassword: '',
            rol_id: currentUser.rol_id,
            activo: currentUser.activo,
            modulo_ids: currentUser.modulos?.map((module) => module.id) ?? [],
          });
          this.setPasswordValidators(false);
          this.resetFormState();
          this.isModalOpen.set(true);
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cargar el usuario.'));
        },
      });
  }

  // ==========================================
  // MODAL, PERMISOS Y VISIBILIDAD DE CONTRASEÑAS
  // ==========================================
  closeModal(): void {
    if (!this.isSaving()) {
      this.isModalOpen.set(false);
    }
  }

  onModuleChange(moduleId: number, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const selected = new Set(this.form.controls.modulo_ids.value);
    if (input.checked) {
      selected.add(moduleId);
    } else {
      selected.delete(moduleId);
    }
    this.form.controls.modulo_ids.setValue([...selected]);
    this.form.controls.modulo_ids.markAsTouched();
  }

  togglePassword(field: 'password' | 'confirmPassword'): void {
    if (field === 'password') {
      this.showPassword.update((visible) => !visible);
    } else {
      this.showConfirmPassword.update((visible) => !visible);
    }
  }

  // ==========================================
  // GUARDAR USUARIO
  // ==========================================
  save(): void {
    this.errorMessage.set('');
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.hasError('passwordMismatch')) {
      this.errorMessage.set('Las contraseñas no coinciden.');
      return;
    }
    if (this.form.controls.modulo_ids.hasError('minModules')) {
      this.errorMessage.set('Debe seleccionar al menos 2 módulos.');
      return;
    }
    if (this.form.invalid) {
      return;
    }

    const raw = this.form.getRawValue();
    const id = this.editingId();
    const request =
      id === null
        ? this.usuariosService.create({
            nombre: raw.nombre.trim(),
            apellido: raw.apellido.trim(),
            username: raw.username.trim(),
            password: raw.password,
            rol_id: raw.rol_id,
            activo: raw.activo,
            modulo_ids: raw.modulo_ids,
          } satisfies UsuarioCreate)
        : this.usuariosService.update(id, this.buildUpdatePayload(raw));

    this.isSaving.set(true);
    request.pipe(finalize(() => this.isSaving.set(false))).subscribe({
      next: (savedUser) => {
        this.users.update((users) =>
          id === null
            ? [savedUser, ...users]
            : users.map((user) => (user.id === savedUser.id ? savedUser : user)),
        );
        this.isModalOpen.set(false);
        this.notice.set({
          title: id === null ? 'Usuario creado correctamente' : 'Usuario actualizado correctamente',
          message:
            id === null
              ? 'La información del usuario se ha registrado con éxito en el sistema.'
              : 'Los cambios del usuario se han guardado con éxito.',
        });
      },
      error: (error: unknown) => {
        this.errorMessage.set(getApiErrorMessage(error, 'No fue posible guardar el usuario.'));
      },
    });
  }

  // ==========================================
  // ESTADO, ELIMINACION LOGICA Y ACTIVACION
  // ==========================================
  toggleStatus(user: Usuario): void {
    this.errorMessage.set('');
    if (user.activo && this.auth.currentUser()?.id === user.id) {
      this.errorMessage.set('No puedes eliminar al usuario administrador de la sesión actual.');
      return;
    }
    this.notice.set(null);
    if (user.activo) {
      this.statusConfirmation.set(user);
      return;
    }
    this.changeStatus(user);
  }

  confirmStatusChange(): void {
    const user = this.statusConfirmation();
    this.statusConfirmation.set(null);
    if (user) {
      this.changeStatus(user);
    }
  }

  cancelStatusChange(): void {
    this.statusConfirmation.set(null);
  }

  clearNotice(): void {
    this.notice.set(null);
  }

  // ==========================================
  // HELPERS DEL COMPONENTE
  // ==========================================
  private changeStatus(user: Usuario): void {
    this.isChangingStatus.set(user.id);
    this.usuariosService
      .setActive(user.id, !user.activo)
      .pipe(finalize(() => this.isChangingStatus.set(null)))
      .subscribe({
        next: (updatedUser) => {
          this.users.update((users) =>
            users.map((item) => (item.id === updatedUser.id ? updatedUser : item)),
          );
          this.notice.set(
            updatedUser.activo
              ? {
                  title: 'Usuario activado correctamente',
                  message: 'El acceso del usuario se ha habilitado nuevamente.',
                }
              : {
                  title: 'Usuario eliminado correctamente',
                  message: 'El usuario se ha eliminado correctamente del sistema.',
                },
          );
        },
        error: (error: unknown) => {
          this.errorMessage.set(getApiErrorMessage(error, 'No fue posible cambiar el estado.'));
        },
      });
  }

  private setPasswordValidators(required: boolean): void {
    const passwordValidators = required
      ? [Validators.required, Validators.minLength(8)]
      : [Validators.minLength(8)];
    this.form.controls.password.setValidators(passwordValidators);
    this.form.controls.confirmPassword.setValidators(required ? [Validators.required] : []);
    this.form.controls.password.updateValueAndValidity();
    this.form.controls.confirmPassword.updateValueAndValidity();
    this.form.updateValueAndValidity();
  }

  private resetFormState(): void {
    this.errorMessage.set('');
    this.submitted.set(false);
    this.showPassword.set(false);
    this.showConfirmPassword.set(false);
    this.form.markAsUntouched();
  }

  private buildUpdatePayload(raw: ReturnType<typeof this.form.getRawValue>): UsuarioUpdate {
    const payload: UsuarioUpdate = {
      nombre: raw.nombre.trim(),
      apellido: raw.apellido.trim(),
      username: raw.username.trim(),
      rol_id: raw.rol_id,
      activo: raw.activo,
      modulo_ids: raw.modulo_ids,
    };
    if (raw.password) {
      payload.password = raw.password;
    }
    return payload;
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
