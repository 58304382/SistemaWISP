// ==========================================
// IMPORTS
// ==========================================
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { UsuariosService } from '../../core/services/usuarios.service';
import { Modulo, Usuario } from '../../core/models/usuario.models';
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
  };

  beforeEach(async () => {
    usuariosService = {
      getAll: vi.fn().mockReturnValue(of([user])),
      getModules: vi.fn().mockReturnValue(of(modules)),
      getById: vi.fn().mockReturnValue(of(user)),
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
      nombre: 'Luis',
      apellido: 'Yax',
      username: 'luis',
      rol_id: 2,
      activo: true,
      password: '',
      confirmPassword: '',
      modulo_ids: [1, 3],
    });
  });

  it('combina búsqueda y filtro por rol en tiempo real', () => {
    component.setFilter('employee');
    component.searchTerm.set('LUIS');

    expect(component.filteredUsers()).toEqual([user]);

    component.searchTerm.set('inexistente');
    expect(component.filteredUsers()).toEqual([]);
  });
});
