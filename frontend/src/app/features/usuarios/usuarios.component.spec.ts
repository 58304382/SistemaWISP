// ==========================================
// IMPORTS
// ==========================================
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { UsuariosService } from '../../core/services/usuarios.service';
import { EmpleadoDisponible, Modulo, Usuario } from '../../core/models/usuario.models';
import { UsuariosComponent } from './usuarios.component';

// ==========================================
// PRUEBAS DEL MODULO USUARIOS
// ==========================================
describe('UsuariosComponent', () => {
  let fixture: ComponentFixture<UsuariosComponent>;
  let component: UsuariosComponent;
  let usuariosService: {
    getAll: ReturnType<typeof vi.fn>;
    getModules: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getAvailableEmployees: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    setActive: ReturnType<typeof vi.fn>;
  };

  const modules: Modulo[] = [
    { id: 1, nombre: 'Clientes', codigo: 'clientes', activo: true },
    { id: 2, nombre: 'Pagos', codigo: 'pagos', activo: true },
    { id: 3, nombre: 'Caja', codigo: 'caja', activo: true },
  ];
  const user: Usuario = {
    id: 5,
    nombre: 'Luis',
    apellido: 'Yax',
    username: 'luis',
    rol_id: 2,
    activo: true,
    created_at: null,
    updated_at: null,
    rol: { id: 2, nombre: 'Empleado' },
    modulos: [modules[0], modules[2]],
    empleado: null,
  };
  const employee: EmpleadoDisponible = {
    id_empleado: 7,
    codigo: 'EMP-0007',
    nombres: 'José Luis',
    apellidos: 'Yax Pérez',
    id_puesto: 2,
    nombre_puesto: 'Técnico',
  };

  beforeEach(async () => {
    usuariosService = {
      getAll: vi.fn().mockReturnValue(of([user])),
      getModules: vi.fn().mockReturnValue(of(modules)),
      getById: vi.fn().mockReturnValue(of(user)),
      getAvailableEmployees: vi.fn().mockReturnValue(of([employee])),
      create: vi.fn().mockReturnValue(of(user)),
      update: vi.fn().mockReturnValue(of(user)),
      setActive: vi.fn().mockReturnValue(of(user)),
    };
    await TestBed.configureTestingModule({
      imports: [UsuariosComponent],
      providers: [
        provideRouter([]),
        { provide: UsuariosService, useValue: usuariosService },
        { provide: AuthService, useValue: { currentUser: signal<Usuario | null>(user) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UsuariosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('abre Editar al hacer clic y carga los datos y permisos reales', async () => {
    const editButton = fixture.nativeElement.querySelector(
      '[title="Editar usuario"]',
    ) as HTMLButtonElement;

    editButton.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(usuariosService.getById).toHaveBeenCalledWith(user.id);
    expect(component.isModalOpen()).toBe(true);
    expect(component.form.getRawValue()).toMatchObject({
      id_empleado: 0,
      nombre: 'Luis',
      apellido: 'Yax',
      username: 'luis',
      rol_id: 2,
      activo: true,
      password: '',
      confirmPassword: '',
      modulo_ids: [1, 3],
    });
    expect(usuariosService.getAvailableEmployees).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#employee-search')).toBeNull();
    expect(fixture.nativeElement.querySelector('#name')).toBeTruthy();
  });

  it('mantiene compatible la edición de un usuario histórico sin empleado', () => {
    component.openEdit(user);
    fixture.detectChanges();

    component.save();

    const payload = usuariosService.update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      nombre: 'Luis',
      apellido: 'Yax',
      username: 'luis',
      rol_id: 2,
      activo: true,
      modulo_ids: [1, 3],
    });
    expect(payload).not.toHaveProperty('id_empleado');
    expect(payload).not.toHaveProperty('password');
  });

  it('muestra el empleado asociado como información al editar sin permitir reasignarlo', () => {
    const linkedUser: Usuario = {
      ...user,
      empleado: {
        id_empleado: 7,
        codigo: 'EMP-0007',
        nombres: 'José Luis',
        apellidos: 'Yax Pérez',
        puesto: { id_puesto: 2, nombre: 'Técnico' },
      },
    };
    usuariosService.getById.mockReturnValue(of(linkedUser));

    component.openEdit(linkedUser);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.readonly-summary').textContent).toContain(
      'EMP-0007 — José Luis Yax Pérez',
    );
    expect(fixture.nativeElement.querySelector('#employee-select')).toBeNull();
  });

  it('combina búsqueda y filtro por rol en tiempo real', () => {
    component.setFilter('employee');
    component.searchTerm.set('LUIS');

    expect(component.filteredUsers()).toEqual([user]);

    component.searchTerm.set('inexistente');
    expect(component.filteredUsers()).toEqual([]);
  });

  it('carga empleados disponibles y sustituye nombre y apellido al crear', () => {
    component.openCreate();
    fixture.detectChanges();

    expect(usuariosService.getAvailableEmployees).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('#employee-search')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#employee-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#name')).toBeNull();
    expect(fixture.nativeElement.querySelector('#last-name')).toBeNull();
  });

  it('filtra empleados por código, nombre y puesto sin distinguir tildes', () => {
    component.openCreate();

    component.employeeSearch.set('jose');
    expect(component.filteredAvailableEmployees()).toEqual([employee]);
    component.employeeSearch.set('tecnico');
    expect(component.filteredAvailableEmployees()).toEqual([employee]);
    component.employeeSearch.set('EMP-0007');
    expect(component.filteredAvailableEmployees()).toEqual([employee]);
  });

  it('selecciona por id, muestra el resumen y crea sin enviar nombre ni apellido', () => {
    component.openCreate();
    component.form.controls.id_empleado.setValue(employee.id_empleado);
    component.onEmployeeSelectionChange();
    component.form.patchValue({
      username: ' jluis ',
      password: 'password123',
      confirmPassword: 'password123',
      rol_id: 2,
      activo: true,
      modulo_ids: [1, 3],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.employee-summary').textContent).toContain(
      'EMP-0007',
    );
    expect(fixture.nativeElement.querySelector('.employee-summary').textContent).toContain(
      'José Luis Yax Pérez',
    );

    component.save();

    expect(usuariosService.create).toHaveBeenCalledWith({
      id_empleado: 7,
      username: 'jluis',
      password: 'password123',
      rol_id: 2,
      activo: true,
      modulo_ids: [1, 3],
    });
  });

  it('rechaza el alta sin una selección real de empleado', () => {
    component.openCreate();
    component.form.patchValue({
      username: 'jluis',
      password: 'password123',
      confirmPassword: 'password123',
      modulo_ids: [1, 3],
    });

    component.save();

    expect(usuariosService.create).not.toHaveBeenCalled();
    expect(component.form.controls.id_empleado.touched).toBe(true);
  });

  it('mantiene el modal, limpia la selección y refresca ante conflicto de empleado', () => {
    usuariosService.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { detail: 'El empleado ya tiene una cuenta de usuario asociada' },
          }),
      ),
    );
    component.openCreate();
    component.form.patchValue({
      id_empleado: employee.id_empleado,
      username: 'jluis',
      password: 'password123',
      confirmPassword: 'password123',
      modulo_ids: [1, 3],
    });
    component.onEmployeeSelectionChange();

    component.save();

    expect(component.isModalOpen()).toBe(true);
    expect(component.selectedEmployee()).toBeNull();
    expect(component.form.controls.id_empleado.value).toBe(0);
    expect(component.errorMessage()).toContain('El empleado ya tiene una cuenta');
    expect(usuariosService.getAvailableEmployees).toHaveBeenCalledTimes(2);
  });
});
