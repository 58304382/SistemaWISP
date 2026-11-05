import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AsignacionPlan } from '../../models/asignacion-plan.models';
import { AsignacionesPlanService } from '../../services/asignaciones-plan.service';
import { AsignacionPlanesComponent } from './asignacion-planes.component';

describe('AsignacionPlanesComponent', () => {
  let fixture: ComponentFixture<AsignacionPlanesComponent>;
  let component: AsignacionPlanesComponent;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  const asignacion: AsignacionPlan = {
    id_asignacion: 7,
    id_cliente: 4,
    id_plan: 2,
    costo_mensual: 225,
    fecha_inicio: '2026-10-25',
    estado: 'Activo',
    fecha_creacion: '2026-10-25T10:00:00',
    fecha_actualizacion: null,
    cliente: { id_cliente: 4, nombres: 'María', apellidos: 'López', estado: 'Activo' },
    plan: {
      id: 2,
      nombre: 'Hogar 20',
      velocidad: '20 Mbps',
      precio_mensual: 225,
      estado: 'Activo',
    },
  };
  const otroCliente = {
    id_cliente: 8,
    nombres: 'Carlos',
    apellidos: 'Méndez',
    estado: 'Activo',
  };

  beforeEach(async () => {
    service = {
      getAll: vi.fn().mockReturnValue(of([asignacion])),
      getById: vi.fn().mockReturnValue(of(asignacion)),
      getClientes: vi.fn().mockReturnValue(of([asignacion.cliente, otroCliente])),
      getPlanes: vi.fn().mockReturnValue(of([asignacion.plan])),
      create: vi.fn().mockReturnValue(of(asignacion)),
      update: vi.fn().mockReturnValue(of(asignacion)),
      delete: vi.fn().mockReturnValue(of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [AsignacionPlanesComponent],
      providers: [provideRouter([]), { provide: AsignacionesPlanService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(AsignacionPlanesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('muestra listado, búsqueda, filtro y acciones Ver, Editar y Eliminar', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Asignación de Planes');
    expect(text).toContain('María López');
    expect(text).toContain('Hogar 20');
    expect(text).toContain('Nueva Asignación');
    expect(text).toContain('Ver');
    expect(text).toContain('Editar');
    expect(text).toContain('Eliminar');
  });

  it('muestra automáticamente el precio y guarda sin enviarlo', () => {
    component.openCreate();
    component.form.patchValue({
      id_cliente: 4,
      id_plan: 2,
      fecha_inicio: '2026-10-25',
      estado: 'Activo',
    });
    component.onPlanChange();

    expect(component.formattedSelectedPrice()).toBe('Q 225.00');
    component.saveAsignacion();

    const payload = service['create'].mock.calls[0][0];
    expect(payload).toEqual({
      id_cliente: 4,
      id_plan: 2,
      fecha_inicio: '2026-10-25',
      estado: 'Activo',
    });
    expect(payload.costo_mensual).toBeUndefined();
  });

  it('busca por nombres y apellidos y conserva el id_cliente seleccionado', () => {
    component.openCreate();
    component.clientSearch.set('mendez');

    expect(component.filteredClients()).toEqual([otroCliente]);
    component.selectClient(otroCliente);

    expect(component.form.controls.id_cliente.value).toBe(8);
    expect(component.clientSearch()).toBe('Carlos Méndez');
    expect(component.isClientDropdownOpen()).toBe(false);
  });

  it('filtra por cliente y estado', () => {
    component.searchTerm.set('maria');
    component.estadoFiltro.set('Activo');
    expect(component.filteredAsignaciones()).toHaveLength(1);

    component.estadoFiltro.set('Inactivo');
    expect(component.filteredAsignaciones()).toHaveLength(0);
  });

  it('consulta el detalle actual antes de ver o editar', () => {
    component.openDetails(asignacion);
    component.openEdit(asignacion);

    expect(service['getById']).toHaveBeenCalledTimes(2);
    expect(component.selectedAsignacion()).toEqual(asignacion);
    expect(component.editingAsignacion()).toEqual(asignacion);
  });

  it('confirma, elimina únicamente la asignación y actualiza el listado', () => {
    component.requestDelete(asignacion);
    fixture.detectChanges();

    const confirmation = fixture.nativeElement.querySelector('.confirmation-modal');
    expect(confirmation.textContent).toContain('¿Eliminar asignación?');
    expect(confirmation.textContent).toContain('El cliente y el plan se conservarán.');

    component.confirmDelete();

    expect(service['delete']).toHaveBeenCalledWith(7);
    expect(component.asignaciones()).toEqual([]);
    expect(component.deleteConfirmation()).toBeNull();
    expect(component.notice()?.title).toBe('Asignación eliminada');
  });

  it('conserva la asignación y muestra el conflicto por historial relacionado', () => {
    service['delete'].mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              detail:
                'La asignación tiene historial financiero o registros relacionados y no puede eliminarse. Puede cambiar su estado a «Cancelado».',
            },
          }),
      ),
    );
    component.requestDelete(asignacion);

    component.confirmDelete();

    expect(component.asignaciones()).toEqual([asignacion]);
    expect(component.deleteConfirmation()).toEqual(asignacion);
    expect(component.errorMessage()).toContain('Cancelado');
  });
});
