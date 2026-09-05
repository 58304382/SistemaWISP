import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { PlanesService } from '../../core/services/planes.service';
import { Plan } from '../../core/models/plan.models';
import { PlanesComponent } from './planes.component';

describe('PlanesComponent', () => {
  let fixture: ComponentFixture<PlanesComponent>;
  let component: PlanesComponent;
  let planesService: {
    getAll: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const standardPlan: Plan = {
    id: 1,
    nombre: 'Básico',
    velocidad: '10 Mbps',
    precio_mensual: 150,
    tipo_plan: 'ESTANDAR',
    estado: 'Activo',
    descripcion: null,
    created_at: null,
    updated_at: null,
  };
  const customPlan: Plan = {
    ...standardPlan,
    id: 2,
    nombre: 'Plan Especial 35',
    velocidad: '35 Mbps',
    precio_mensual: 375,
    tipo_plan: 'PERSONALIZADO',
  };
  const inactivePlan: Plan = {
    ...standardPlan,
    id: 3,
    nombre: 'Avanzado',
    velocidad: '20 Mbps',
    precio_mensual: 250,
    estado: 'Inactivo',
  };

  beforeEach(async () => {
    planesService = {
      getAll: vi.fn().mockReturnValue(of([standardPlan])),
      getById: vi.fn().mockReturnValue(of(standardPlan)),
      create: vi.fn().mockReturnValue(of(standardPlan)),
      update: vi.fn().mockReturnValue(of(standardPlan)),
      delete: vi.fn().mockReturnValue(of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [PlanesComponent],
      providers: [
        provideRouter([]),
        { provide: PlanesService, useValue: planesService },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({
              id: 1,
              nombre: 'Admin',
              apellido: 'User',
              username: 'admin',
              rol_id: 1,
              activo: true,
              created_at: null,
              updated_at: null,
              rol: { id: 1, nombre: 'Administrador' },
              modulos: [{ id: 3, nombre: 'Planes', codigo: 'planes', activo: true }],
            }),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlanesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga solamente el tipo seleccionado y filtra en tiempo real', () => {
    component.openManagement('ESTANDAR');
    component.plans.set([standardPlan, inactivePlan, customPlan]);
    component.searchTerm.set('10 Mbps');

    expect(planesService.getAll).toHaveBeenCalledWith('ESTANDAR');
    expect(component.filteredPlans()).toEqual([standardPlan]);

    component.openManagement('PERSONALIZADO');
    expect(planesService.getAll).toHaveBeenLastCalledWith('PERSONALIZADO');
  });

  it('aplica los filtros Todos, Activos e Inactivos al listado', () => {
    component.openManagement('ESTANDAR');
    component.plans.set([standardPlan, inactivePlan]);

    expect(component.activeFilter()).toBe('all');
    expect(component.filteredPlans()).toEqual([standardPlan, inactivePlan]);

    component.setFilter('active');
    expect(component.filteredPlans()).toEqual([standardPlan]);

    component.setFilter('inactive');
    expect(component.filteredPlans()).toEqual([inactivePlan]);
  });

  it('renderiza la toolbar y las acciones con las clases del patrón de Usuarios', () => {
    component.openManagement('ESTANDAR');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.list-heading h2').textContent).toContain(
      'Lista de planes',
    );
    expect(fixture.nativeElement.querySelectorAll('.filter-chip')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.filter-chip.selected').textContent).toContain(
      'Todos',
    );
    expect(fixture.nativeElement.querySelector('.primary-button').textContent).toContain(
      'Nuevo plan',
    );
    const newPlanButton = fixture.nativeElement.querySelector(
      '.plans-new-button',
    ) as HTMLButtonElement;
    const newPlanStyles = getComputedStyle(newPlanButton);
    expect(newPlanStyles.display).toBe('inline-flex');
    expect(newPlanStyles.backgroundColor).toBe('rgb(52, 105, 190)');
    expect(newPlanStyles.borderTopWidth).toBe('0px');
    expect(newPlanStyles.height).toBe('41px');

    const tableStyles = getComputedStyle(fixture.nativeElement.querySelector('.table-card'));
    expect(tableStyles.minHeight).not.toBe('250px');

    const actionButtons = fixture.nativeElement.querySelectorAll('.icon-action');
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[0].getAttribute('title')).toBe('Editar plan');
    expect(actionButtons[1].getAttribute('title')).toBe('Eliminar plan');
    expect(actionButtons[0].querySelector('svg')).toBeTruthy();
    expect(actionButtons[1].querySelector('svg')).toBeTruthy();
  });

  it('crea un plan con el tipo asignado por la gestión actual y libera saving', () => {
    component.openManagement('ESTANDAR');
    component.openCreate();
    component.form.setValue({
      nombre: 'Intermedio',
      velocidad: '15 Mbps',
      precio_mensual: '200.00',
      estado: 'Activo',
      descripcion: '',
    });

    component.save();

    expect(planesService.create).toHaveBeenCalledWith({
      nombre: 'Intermedio',
      velocidad: '15 Mbps',
      precio_mensual: 200,
      tipo_plan: 'ESTANDAR',
      estado: 'Activo',
      descripcion: null,
    });
    expect(component.isSaving()).toBe(false);
  });

  it('edita y elimina físicamente un plan sin dejar estados activos', () => {
    component.openManagement('ESTANDAR');
    component.plans.set([standardPlan]);
    component.openEdit(standardPlan);
    component.form.controls.nombre.setValue('Básico actualizado');
    component.save();

    expect(planesService.getById).toHaveBeenCalledWith(standardPlan.id);
    expect(planesService.update).toHaveBeenCalledWith(
      standardPlan.id,
      expect.objectContaining({ nombre: 'Básico actualizado' }),
    );
    expect(component.isSaving()).toBe(false);

    component.requestDelete(standardPlan);
    component.confirmDelete();

    expect(planesService.delete).toHaveBeenCalledWith(standardPlan.id);
    expect(component.plans()).toEqual([]);
    expect(component.deletingId()).toBeNull();
  });
});
