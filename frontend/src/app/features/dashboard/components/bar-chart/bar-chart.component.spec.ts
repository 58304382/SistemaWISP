import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardBarChartComponent } from './bar-chart.component';

describe('DashboardBarChartComponent', () => {
  let fixture: ComponentFixture<DashboardBarChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardBarChartComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardBarChartComponent);
  });

  it('representa cada barra con su valor formateado', () => {
    fixture.componentRef.setInput('items', [
      { etiqueta: 'Internet', valor: 500, detalle: '2 pagos' },
      { etiqueta: 'Instalaciones', valor: 100, detalle: '1 pago' },
    ]);
    fixture.componentRef.setInput('moneda', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.bar-row').length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Internet');
    expect(fixture.nativeElement.textContent).toContain('2 pagos');
    expect(fixture.nativeElement.querySelector('.bar-fill').style.width).toBe('100%');
  });

  it('muestra el estado vacío sin barras con valor', () => {
    fixture.componentRef.setInput('items', [{ etiqueta: 'Sin datos', valor: 0 }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.bar-empty')).not.toBeNull();
  });
});
