import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { EvaluacionVisitaComponent } from './evaluacion-visita.component';

describe('EvaluacionVisitaComponent', () => {
  let fixture: ComponentFixture<EvaluacionVisitaComponent>;
  let component: EvaluacionVisitaComponent;
  let visitasService: {
    startEvaluation: ReturnType<typeof vi.fn>;
    finishEvaluation: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    visitasService = {
      startEvaluation: vi.fn().mockReturnValue(of({ estado: 'En Proceso' })),
      finishEvaluation: vi.fn().mockReturnValue(of({ id_visita: 1, estado: 'Completada' })),
    };
    await TestBed.configureTestingModule({
      imports: [EvaluacionVisitaComponent],
      providers: [{ provide: VisitasTecnicasService, useValue: visitasService }],
    }).compileComponents();
    fixture = TestBed.createComponent(EvaluacionVisitaComponent);
    component = fixture.componentInstance;
  });

  it('valida campos obligatorios sin intentar persistir', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 1,
      cliente: 'Cliente',
      estado: 'Programada',
    });
    fixture.detectChanges();

    component.submit(new Event('submit'));

    expect(Object.keys(component.errors())).toHaveLength(4);
    expect(component.formMessage()).toBe('');
  });

  it('reutiliza la evaluación existente en solo lectura cuando está completada', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 2,
      cliente: 'Cliente',
      estado: 'Completada',
      evaluacion: {
        descripcionTrabajo: 'Instalar enlace',
        tecnicosRecomendados: 2,
        materiales: ['Cable'],
        materialesDetalle: [{ descripcion: 'Cable', cantidad: 30, unidad: 'Metro' }],
        condicionesLugar: 'Acceso alto',
        observacionTecnica: 'Factible',
        ubicacionRegistrada: false,
      },
    });
    fixture.detectChanges();

    expect(component.readonlyMode).toBe(true);
    expect(component.descripcionTrabajo()).toBe('Instalar enlace');
    expect(component.materialesDetalle()).toEqual([
      { descripcion: 'Cable', cantidad: 30, unidad: 'Metro' },
    ]);
    expect(fixture.nativeElement.querySelector('.primary-button')).toBeNull();
  });

  it('captura descripción, cantidad y unidad en cada fila y permite eliminarla', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 4,
      cliente: 'Cliente',
      estado: 'Programada',
    });
    fixture.detectChanges();

    component.addMaterial();
    fixture.detectChanges();
    const description = fixture.nativeElement.querySelector(
      '[aria-label="Descripción del material o accesorio"]',
    ) as HTMLInputElement;
    const quantity = fixture.nativeElement.querySelector(
      '[aria-label="Cantidad del material o accesorio"]',
    ) as HTMLInputElement;
    const unit = fixture.nativeElement.querySelector(
      '[aria-label="Unidad del material o accesorio"]',
    ) as HTMLInputElement;

    description.value = 'Cable UTP';
    description.dispatchEvent(new Event('input'));
    quantity.value = '30';
    quantity.dispatchEvent(new Event('input'));
    unit.value = 'Metro';
    unit.dispatchEvent(new Event('input'));

    expect(component.materialesDetalle()).toEqual([
      { descripcion: 'Cable UTP', cantidad: 30, unidad: 'Metro' },
    ]);
    expect(description.maxLength).toBe(200);
    expect(quantity.min).toBe('0.01');
    expect(unit.maxLength).toBe(30);
    component.removeMaterial(0);
    expect(component.materialesDetalle()).toEqual([]);
  });

  it('valida descripción, cantidad positiva y longitud de unidad antes de guardar', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 5,
      cliente: 'Cliente',
      estado: 'Programada',
    });
    fixture.detectChanges();
    component.descripcionTrabajo.set('Instalar enlace');
    component.tecnicosRecomendados.set(2);
    component.condicionesLugar.set('Acceso alto');
    component.observacionTecnica.set('Factible');
    component.materialesDetalle.set([
      { descripcion: ' ', cantidad: 0, unidad: 'U'.repeat(31) },
    ]);

    component.submit(new Event('submit'));

    expect(component.materialErrors()[0]).toEqual({
      descripcion: 'La descripción es obligatoria.',
      cantidad: 'La cantidad debe ser mayor que 0.',
      unidad: 'La unidad no puede exceder 30 caracteres.',
    });
    expect(visitasService.startEvaluation).not.toHaveBeenCalled();
    expect(visitasService.finishEvaluation).not.toHaveBeenCalled();
  });

  it('fuerza solo lectura al abrir Ver aunque la visita esté Programada', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 3,
      cliente: 'Cliente',
      tecnico: 'PABLO MERIDA',
      fecha: '2026-09-25',
      hora: '09:00',
      tipoInstalacion: 'Internet',
      descripcion: 'Revisar cobertura',
      estado: 'Programada',
      soloLectura: true,
    });
    fixture.detectChanges();

    expect(component.readonlyMode).toBe(true);
    expect(component.title).toContain('Ver visita');
    expect(component.title).toContain('ID 3');
    expect(fixture.nativeElement.textContent).toContain('PABLO MERIDA');
    expect(fixture.nativeElement.querySelector('.primary-button')).toBeNull();
  });

  it('inicia y finaliza la evaluación Programada con el id_visita real', () => {
    fixture.componentRef.setInput('task', {
      id_visita: 15,
      cliente: 'Cliente',
      estado: 'Programada',
    });
    fixture.detectChanges();
    component.descripcionTrabajo.set('Instalar enlace');
    component.tecnicosRecomendados.set(2);
    component.condicionesLugar.set('Acceso alto');
    component.observacionTecnica.set('Factible');
    component.materialesDetalle.set([
      { descripcion: ' Cable UTP ', cantidad: 30, unidad: ' Metro ' },
      { descripcion: 'Router', cantidad: 1, unidad: 'Unidad' },
    ]);

    component.submit(new Event('submit'));

    const payload = {
      descripcion_trabajo: 'Instalar enlace',
      tecnicos_recomendados: 2,
      condiciones_lugar: 'Acceso alto',
      observacion_tecnica: 'Factible',
      materiales: [
        { descripcion: 'Cable UTP', cantidad: 30, unidad: 'Metro' },
        { descripcion: 'Router', cantidad: 1, unidad: 'Unidad' },
      ],
    };
    expect(visitasService.startEvaluation).toHaveBeenCalledWith(15, payload);
    expect(visitasService.finishEvaluation).toHaveBeenCalledWith(15, payload);
  });

  it('no vuelve a crear la evaluación si falla la finalización después de iniciarla', () => {
    const startedVisit = { id_visita: 15, estado: 'En Proceso' };
    visitasService.startEvaluation.mockReturnValue(of(startedVisit));
    visitasService.finishEvaluation.mockReturnValue(
      throwError(() => new Error('No se pudo finalizar')),
    );
    const progressed = vi.fn();
    component.progressed.subscribe(progressed);
    fixture.componentRef.setInput('task', {
      id_visita: 15,
      cliente: 'Cliente',
      estado: 'Programada',
    });
    fixture.detectChanges();
    component.descripcionTrabajo.set('Instalar enlace');
    component.tecnicosRecomendados.set(2);
    component.condicionesLugar.set('Acceso alto');
    component.observacionTecnica.set('Factible');

    component.submit(new Event('submit'));
    component.submit(new Event('submit'));

    expect(progressed).toHaveBeenCalledWith(startedVisit);
    expect(component.evaluationState()).toBe('En Proceso');
    expect(visitasService.startEvaluation).toHaveBeenCalledTimes(1);
    expect(visitasService.finishEvaluation).toHaveBeenCalledTimes(2);
  });
});
