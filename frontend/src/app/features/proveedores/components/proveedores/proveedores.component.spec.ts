import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { Proveedor } from '../../models/proveedor.models';
import { ProveedoresService } from '../../services/proveedores.service';
import { ProveedoresComponent } from './proveedores.component';

describe('ProveedoresComponent', () => {
  let fixture: ComponentFixture<ProveedoresComponent>;
  let component: ProveedoresComponent;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const proveedor: Proveedor = {
    id_proveedor: 7,
    nombre: 'Conexiones del Lago',
    nit: '1234-5',
    contacto: 'Ana López',
    telefono: '5555-0101',
    correo: 'ventas@lago.gt',
    direccion: 'Zona 1',
    id_municipio: 2,
    estado: 'Activo',
    observaciones: null,
    municipio: {
      id_municipio: 2,
      id_departamento: 1,
      nombre: 'Panajachel',
      codigo_postal: null,
      estado: 'Activo',
    },
  };

  beforeEach(async () => {
    service = {
      getAll: vi.fn().mockReturnValue(of([proveedor])),
      getById: vi.fn().mockReturnValue(of(proveedor)),
      getDepartamentos: vi.fn().mockReturnValue(of([])),
      getMunicipios: vi.fn().mockReturnValue(of([proveedor.municipio])),
      create: vi.fn().mockReturnValue(of(proveedor)),
      update: vi.fn().mockReturnValue(of(proveedor)),
      delete: vi.fn().mockReturnValue(of(undefined)),
      setEstado: vi.fn().mockReturnValue(of({ ...proveedor, estado: 'Inactivo' })),
    };
    await TestBed.configureTestingModule({
      imports: [ProveedoresComponent],
      providers: [{ provide: ProveedoresService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProveedoresComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('muestra el ID real y todas las acciones solicitadas', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('7');
    expect(text).not.toContain('PRO-0007');
    expect(text).toContain('Ver');
    expect(text).toContain('Editar');
    expect(text).toContain('Eliminar');
    expect(text).toContain('Inactivar');
  });

  it('registra sin enviar ID ni departamento', () => {
    component.openCreate();
    component.form.controls.id_municipio.enable();
    component.form.patchValue({
      nombre: 'Conexiones del Lago',
      id_departamento: 1,
      id_municipio: 2,
    });

    component.saveProveedor();

    const payload = service['create'].mock.calls[0][0];
    expect(payload.id_proveedor).toBeUndefined();
    expect(payload.id_departamento).toBeUndefined();
    expect(payload.id_municipio).toBe(2);
  });

  it('recupera automáticamente el departamento al editar', () => {
    component.openEdit(proveedor);

    expect(service['getById']).toHaveBeenCalledWith(7);
    expect(service['getMunicipios']).toHaveBeenCalledWith(1);
    expect(component.form.controls.id_departamento.value).toBe(1);
    expect(component.form.controls.id_municipio.value).toBe(2);
  });

  it('ofrece el mensaje del backend cuando debe inactivarse', () => {
    service['delete'].mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { detail: 'Tiene relaciones. Puede inactivarlo.' },
          }),
      ),
    );
    component.requestDelete(proveedor);

    component.confirmDelete();

    expect(component.errorMessage()).toContain('Puede inactivarlo');
    expect(component.deleteConfirmation()).toBe(proveedor);
  });
});
