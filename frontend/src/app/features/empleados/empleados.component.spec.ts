import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { Empleado } from '../../core/models/empleado.models';
import { EmpleadosService } from '../../core/services/empleados.service';
import { EmpleadosComponent } from './empleados.component';

describe('EmpleadosComponent', () => {
  let fixture: ComponentFixture<EmpleadosComponent>;
  let component: EmpleadosComponent;
  let empleadosService: {
    getAll: ReturnType<typeof vi.fn>;
    getPuestos: ReturnType<typeof vi.fn>;
    getDepartamentos: ReturnType<typeof vi.fn>;
    getMunicipios: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    replacePhoto: ReturnType<typeof vi.fn>;
    removePhoto: ReturnType<typeof vi.fn>;
  };
  const savedEmployee: Empleado = {
    id_empleado: 1,
    codigo: 'EMP-0001',
    nombres: 'Ana',
    apellidos: 'Lopez',
    tipo_documento: 'DPI',
    numero_documento: '123456789',
    telefono_principal: '55555555',
    telefono_alternativo: null,
    correo: null,
    direccion: 'Zona 1',
    fecha_ingreso: '2026-01-01',
    estado: 'Activo',
    observaciones: null,
    foto_perfil: null,
    id_puesto: 1,
    nombre_puesto: 'Administrativo',
    id_municipio: 2,
    nombre_municipio: 'Municipio',
    id_departamento: 1,
    nombre_departamento: 'Departamento',
  };

  beforeEach(async () => {
    empleadosService = {
      getAll: vi.fn().mockReturnValue(of([])),
      getPuestos: vi.fn().mockReturnValue(
        of([
          {
            id_puesto: 1,
            nombre: 'Administrativo',
            descripcion: null,
            estado: 'Activo',
            tiene_funciones_sistema: true,
          },
          {
            id_puesto: 2,
            nombre: 'Técnico',
            descripcion: null,
            estado: 'Activo',
            tiene_funciones_sistema: true,
          },
          {
            id_puesto: 3,
            nombre: 'Atención al cliente',
            descripcion: null,
            estado: 'Activo',
            tiene_funciones_sistema: true,
          },
        ]),
      ),
      getDepartamentos: vi.fn().mockReturnValue(of([])),
      getMunicipios: vi.fn().mockReturnValue(of([])),
      getById: vi.fn().mockReturnValue(of(savedEmployee)),
      create: vi.fn().mockReturnValue(of(savedEmployee)),
      update: vi.fn().mockReturnValue(of(savedEmployee)),
      delete: vi.fn().mockReturnValue(of({ ...savedEmployee, estado: 'Inactivo' })),
      replacePhoto: vi.fn().mockReturnValue(of(savedEmployee)),
      removePhoto: vi.fn().mockReturnValue(of(savedEmployee)),
    };
    await TestBed.configureTestingModule({
      imports: [EmpleadosComponent],
      providers: [{ provide: EmpleadosService, useValue: empleadosService }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmpleadosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function fillRequiredFields(): void {
    component.openCreate();
    component.form.controls.id_municipio.enable();
    component.form.patchValue({
      nombres: 'Ana',
      apellidos: 'Lopez',
      id_puesto: 1,
      numero_documento: '123456789',
      telefono_principal: '55555555',
      id_departamento: 1,
      id_municipio: 2,
      fecha_ingreso: '2026-01-01',
      direccion: 'Zona 1',
    });
  }

  function setEmployeeList(employees: Empleado | Empleado[]): void {
    const employeeList = Array.isArray(employees) ? employees : [employees];
    component.employees.set(
      employeeList.map((employee) => ({
        detail: employee,
        codigo: employee.codigo,
        nombres: employee.nombres,
        apellidos: employee.apellidos,
        correo: employee.correo,
        telefono_principal: employee.telefono_principal,
        puesto: employee.nombre_puesto,
        fecha_ingreso: employee.fecha_ingreso,
        estado: employee.estado,
      })),
    );
  }

  it('crea un empleado sin enviar foto, codigo manual ni departamento', () => {
    fillRequiredFields();

    component.saveEmployee();

    const payload = empleadosService.create.mock.calls[0][0] as FormData;
    expect(payload.get('foto')).toBeNull();
    expect(payload.get('codigo')).toBeNull();
    expect(payload.get('id_departamento')).toBeNull();
    expect(payload.get('id_puesto')).toBe('1');
    expect(payload.get('id_municipio')).toBe('2');
    expect(component.employees()).toHaveLength(1);
    expect(component.isModalOpen()).toBe(false);
    expect(component.notice()).toEqual({
      title: 'Empleado creado correctamente',
      message: 'La información del empleado se ha registrado con éxito.',
    });
    expect(component.isSaving()).toBe(false);

    fixture.detectChanges();
    const successModal = fixture.nativeElement.querySelector('.employee-confirmation-modal');
    expect(successModal.textContent).toContain('Empleado creado correctamente');
    expect(successModal.textContent).toContain(
      'La información del empleado se ha registrado con éxito.',
    );
    expect(successModal.querySelector('button').textContent).toContain('Continuar');

    component.clearNotice();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.employee-confirmation-modal')).toBeNull();
  });

  it('construye el filtro de puestos desde el catalogo del backend', () => {
    component.puestos.set([
      {
        id_puesto: 4,
        nombre: 'Gerente Administrativo',
        descripcion: null,
        estado: 'Activo',
        tiene_funciones_sistema: true,
      },
      {
        id_puesto: 5,
        nombre: 'Secretaria',
        descripcion: null,
        estado: 'Activo',
        tiene_funciones_sistema: false,
      },
    ]);
    fixture.detectChanges();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll(
        'select[aria-label="Filtrar empleados por puesto"] option',
      ),
      (option) => (option as HTMLOptionElement).textContent?.trim(),
    );
    expect(options).toEqual(['Todos', 'Gerente Administrativo', 'Secretaria']);
  });

  it('incluye la fotografia opcional en FormData y limpia el estado al guardar', () => {
    fillRequiredFields();
    const photo = new File(['photo'], 'perfil.png', { type: 'image/png' });
    component.profilePhotoFile.set(photo);
    component.profilePhotoUrl.set('blob:perfil');

    component.saveEmployee();

    const payload = empleadosService.create.mock.calls[0][0] as FormData;
    const sentPhoto = payload.get('foto');
    expect(sentPhoto).toBeInstanceOf(File);
    expect((sentPhoto as File).name).toBe('perfil.png');
    expect(component.profilePhotoFile()).toBeNull();
    expect(component.profilePhotoUrl()).toBeNull();
    expect(component.isModalOpen()).toBe(false);
    expect(component.notice()?.title).toBe('Empleado creado correctamente');
    expect(component.isSaving()).toBe(false);
  });

  it('muestra el detalle del empleado en una tarjeta horizontal y permite cerrarlo', () => {
    component.openDetails(savedEmployee);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.employee-detail-modal');
    expect(modal.textContent).toContain('Detalle del empleado');
    expect(modal.querySelector('.employee-modal-subtitle').textContent).toContain('EMP-0001');
    expect(modal.querySelector('.employee-personal-grid')).toBeTruthy();
    expect(modal.querySelector('.employee-labor-grid')).toBeTruthy();
    expect(modal.querySelector('.employee-detail-photo-item')).toBeTruthy();
    expect(modal.querySelector('.employee-detail-photo-frame')).toBeTruthy();
    expect(modal.querySelector('.employee-detail-photo-empty').textContent).toContain(
      'Sin foto de perfil',
    );

    component.closeDetails();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.employee-detail-modal')).toBeNull();
  });

  it('carga y actualiza el empleado real sin tocar su fotografia', () => {
    const employeeWithPhoto = { ...savedEmployee, foto_perfil: '/uploads/empleados/ana.webp' };
    empleadosService.getById.mockReturnValue(of(employeeWithPhoto));
    empleadosService.update.mockReturnValue(of(employeeWithPhoto));

    component.openEdit(savedEmployee);
    fixture.detectChanges();

    expect(empleadosService.getById).toHaveBeenCalledWith(savedEmployee.id_empleado);
    expect(component.isEditModalOpen()).toBe(true);
    expect(component.form.controls.codigo.value).toBe('EMP-0001');
    expect(component.form.controls.codigo.disabled).toBe(true);
    expect(component.form.controls.id_departamento.value).toBe(1);
    expect(component.form.controls.id_municipio.value).toBe(2);
    expect(component.form.controls.correo.value).toBe('');
    expect(component.profilePhotoUrl()).toContain('/uploads/empleados/ana.webp');

    component.saveEmployee();

    expect(empleadosService.update).toHaveBeenCalledWith(
      savedEmployee.id_empleado,
      expect.objectContaining({
        nombres: 'Ana',
        correo: null,
        observaciones: null,
        id_municipio: 2,
      }),
    );
    expect(empleadosService.replacePhoto).not.toHaveBeenCalled();
    expect(empleadosService.removePhoto).not.toHaveBeenCalled();
    expect(component.isEditModalOpen()).toBe(false);
    expect(component.notice()?.title).toBe('Empleado actualizado correctamente');
  });

  it('marca para eliminar la fotografia guardada y la elimina solo al guardar', () => {
    const employeeWithPhoto = { ...savedEmployee, foto_perfil: '/uploads/empleados/ana.webp' };
    empleadosService.getById.mockReturnValue(of(employeeWithPhoto));
    empleadosService.update.mockReturnValue(of(employeeWithPhoto));
    empleadosService.removePhoto.mockReturnValue(of({ ...employeeWithPhoto, foto_perfil: null }));

    component.openEdit(savedEmployee);
    expect(component.profilePhotoUrl()).toContain('/uploads/empleados/ana.webp');

    component.removeProfilePhoto();
    expect(component.profilePhotoUrl()).toBeNull();
    expect(empleadosService.removePhoto).not.toHaveBeenCalled();

    component.saveEmployee();

    expect(empleadosService.removePhoto).toHaveBeenCalledWith(savedEmployee.id_empleado);
  });

  it('reemplaza la fotografia solo cuando se selecciona una nueva', () => {
    const employeeWithoutPhoto = { ...savedEmployee, foto_perfil: null };
    const replacement = { ...employeeWithoutPhoto, foto_perfil: '/uploads/empleados/new.webp' };
    const photo = new File(['new-photo'], 'new-photo.png', { type: 'image/png' });
    empleadosService.getById.mockReturnValue(of(employeeWithoutPhoto));
    empleadosService.update.mockReturnValue(of(employeeWithoutPhoto));
    empleadosService.replacePhoto.mockReturnValue(of(replacement));
    component.employees.set([
      {
        detail: employeeWithoutPhoto,
        codigo: employeeWithoutPhoto.codigo,
        nombres: employeeWithoutPhoto.nombres,
        apellidos: employeeWithoutPhoto.apellidos,
        correo: employeeWithoutPhoto.correo,
        telefono_principal: employeeWithoutPhoto.telefono_principal,
        puesto: employeeWithoutPhoto.nombre_puesto,
        fecha_ingreso: employeeWithoutPhoto.fecha_ingreso,
        estado: employeeWithoutPhoto.estado,
      },
    ]);

    component.openEdit(savedEmployee);
    component.profilePhotoFile.set(photo);
    component.profilePhotoUrl.set('blob:new-photo');

    component.saveEmployee();

    expect(empleadosService.replacePhoto).toHaveBeenCalledWith(savedEmployee.id_empleado, photo);
    expect(empleadosService.removePhoto).not.toHaveBeenCalled();
    expect(component.employees()[0].detail.foto_perfil).toBe('/uploads/empleados/new.webp');
  });

  it('abre confirmacion y cancelar no realiza ninguna peticion', () => {
    setEmployeeList(savedEmployee);

    component.requestDelete(savedEmployee);
    expect(component.deleteConfirmation()).toEqual(savedEmployee);
    expect(empleadosService.delete).not.toHaveBeenCalled();

    component.cancelDelete();
    expect(component.deleteConfirmation()).toBeNull();
    expect(empleadosService.delete).not.toHaveBeenCalled();
  });

  it('desactiva el empleado, actualiza la tabla y conserva la fotografia', () => {
    const employeeWithPhoto = { ...savedEmployee, foto_perfil: '/uploads/empleados/ana.webp' };
    const deactivatedEmployee = { ...employeeWithPhoto, estado: 'Inactivo' as const };
    empleadosService.delete.mockReturnValue(of(deactivatedEmployee));
    setEmployeeList(employeeWithPhoto);

    component.requestDelete(employeeWithPhoto);
    component.confirmDelete();

    expect(empleadosService.delete).toHaveBeenCalledWith(savedEmployee.id_empleado);
    expect(component.deleteConfirmation()).toBeNull();
    expect(component.employees()[0].detail.estado).toBe('Inactivo');
    expect(component.employees()[0].detail.foto_perfil).toBe('/uploads/empleados/ana.webp');
    expect(component.notice()).toEqual({
      title: 'Empleado eliminado correctamente',
      message: 'El empleado fue desactivado y su información se conservará en el sistema.',
    });
    expect(component.isDeleting()).toBeNull();
  });

  it('impide dos peticiones cuando se confirma dos veces mientras carga', () => {
    const deleteRequest$ = new Subject<Empleado>();
    empleadosService.delete.mockReturnValue(deleteRequest$);
    setEmployeeList(savedEmployee);

    component.requestDelete(savedEmployee);
    component.confirmDelete();
    component.confirmDelete();

    expect(empleadosService.delete).toHaveBeenCalledTimes(1);
    expect(component.isDeleting()).toBe(savedEmployee.id_empleado);

    deleteRequest$.next({ ...savedEmployee, estado: 'Inactivo' });
    deleteRequest$.complete();
    expect(component.isDeleting()).toBeNull();
  });

  it('mantiene la confirmacion abierta y muestra el mensaje correcto ante un 404', () => {
    empleadosService.delete.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    setEmployeeList(savedEmployee);

    component.requestDelete(savedEmployee);
    component.confirmDelete();

    expect(component.deleteConfirmation()).toEqual(savedEmployee);
    expect(component.errorMessage()).toBe('Empleado no encontrado.');
    expect(component.isDeleting()).toBeNull();
    expect(component.employees()[0].detail.estado).toBe('Activo');
  });

  it('no permite solicitar la baja de un empleado que ya esta inactivo', () => {
    const inactiveEmployee = { ...savedEmployee, estado: 'Inactivo' as const };

    component.requestDelete(inactiveEmployee);

    expect(component.deleteConfirmation()).toBeNull();
    expect(empleadosService.delete).not.toHaveBeenCalled();
  });

  it('combina Estado, Puesto y búsqueda sin perder el listado original', () => {
    const inactiveDaniel = {
      ...savedEmployee,
      id_empleado: 2,
      codigo: 'EMP-0002',
      nombres: 'Daniel',
      apellidos: 'Coroxon',
      nombre_puesto: 'Técnico',
      telefono_principal: '55550002',
      estado: 'Inactivo' as const,
    };
    const activeTechnician = {
      ...savedEmployee,
      id_empleado: 3,
      codigo: 'EMP-0003',
      nombres: 'Luis',
      apellidos: 'Pérez',
      nombre_puesto: 'Técnico',
      telefono_principal: '55550003',
    };
    setEmployeeList([savedEmployee, inactiveDaniel, activeTechnician]);
    fixture.detectChanges();

    const selects = fixture.nativeElement.querySelectorAll('.employee-filter select');
    const positionSelect = selects[0] as HTMLSelectElement;
    const statusSelect = selects[1] as HTMLSelectElement;

    statusSelect.value = 'active';
    statusSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.filteredEmployees().map((employee) => employee.codigo)).toEqual([
      'EMP-0001',
      'EMP-0003',
    ]);

    statusSelect.value = 'inactive';
    statusSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.filteredEmployees().map((employee) => employee.codigo)).toEqual(['EMP-0002']);

    positionSelect.value = 'Técnico';
    positionSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(component.filteredEmployees().map((employee) => employee.codigo)).toEqual(['EMP-0002']);

    const search = fixture.nativeElement.querySelector('#employee-search') as HTMLInputElement;
    search.value = 'daniel';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.filteredEmployees().map((employee) => employee.codigo)).toEqual(['EMP-0002']);

    statusSelect.value = 'all';
    statusSelect.dispatchEvent(new Event('change'));
    positionSelect.value = 'all';
    positionSelect.dispatchEvent(new Event('change'));
    search.value = '';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.filteredEmployees()).toHaveLength(3);
  });
});
