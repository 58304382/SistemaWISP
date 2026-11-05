import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardLineChartComponent } from './line-chart.component';

describe('DashboardLineChartComponent', () => {
  let fixture: ComponentFixture<DashboardLineChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardLineChartComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardLineChartComponent);
  });

  it('dibuja las series y sus etiquetas cuando existen valores', () => {
    fixture.componentRef.setInput('series', [
      { nombre: 'Ingresos', color: '#2563eb', valores: [100, 250, 0] },
    ]);
    fixture.componentRef.setInput('etiquetas', ['01/11', '02/11', '03/11']);
    fixture.componentRef.setInput('moneda', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('polyline')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('circle').length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Ingresos');
  });

  it('muestra el estado vacío cuando todas las series son cero', () => {
    fixture.componentRef.setInput('series', [
      { nombre: 'Ingresos', color: '#2563eb', valores: [0, 0] },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.chart-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('polyline')).toBeNull();
  });
});
