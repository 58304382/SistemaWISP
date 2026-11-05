import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AuthService } from '../auth/services/auth.service';
import {
  ConteoModulo,
  DashboardComercial,
  DashboardFinanciero,
  DashboardOperativo,
  IndicadoresClientes,
  IndicadoresFinancieros,
  IndicadoresOperativos,
  IndicadoresServicios,
  PeriodoDashboardResponse,
  ReporteCajaDashboard,
  ResumenDashboard,
} from './models/dashboard.models';
import { DashboardService } from './services/dashboard.service';
import { DashboardComponent } from './dashboard.component';

const periodo: PeriodoDashboardResponse = {
  tipo: 'mes',
  fecha_inicio: '2026-11-01',
  fecha_fin: '2026-11-30',
  descripcion: '01/11/2026 al 30/11/2026',
  granularidad: 'diaria',
};

const modulo = (
  total: number,
  estados: { estado: string; cantidad: number }[],
): ConteoModulo => ({ total, por_estado: estados });

const indicadoresFinancieros: IndicadoresFinancieros = {
  ingresos: '600.00',
  cobros_aplicados: '450.00',
  cartera_pendiente: '1598.74',
  documentos_pendientes: 4,
  morosidad_monto: '120.00',
  documentos_vencidos: 2,
  ingresos_por_origen: [
    { origen: 'INTERNET', monto: '500.00', cantidad: 2 },
    { origen: 'INSTALACIONES', monto: '100.00', cantidad: 1 },
  ],
  cartera_por_origen: [
    { origen: 'INTERNET', monto: '1598.74', cantidad: 4 },
  ],
  morosidad_por_origen: [{ origen: 'INTERNET', monto: '120.00', cantidad: 2 }],
};

const clientes: IndicadoresClientes = {
  total: 6,
  activos: 5,
  inactivos: 1,
  por_estado: [
    { estado: 'Activo', cantidad: 5 },
    { estado: 'Inactivo', cantidad: 1 },
  ],
};

const servicios: IndicadoresServicios = {
  total: 4,
  activos: 2,
  inactivos: 1,
  por_estado: [
    { estado: 'Activo', cantidad: 2 },
    { estado: 'Inactivo', cantidad: 1 },
    { estado: 'Suspendido', cantidad: 1 },
  ],
  clientes_con_servicio_activo: 2,
  ingreso_mensual_contratado: '800.00',
};

const operativo: IndicadoresOperativos = {
  visitas_tecnicas: modulo(3, [
    { estado: 'Programada', cantidad: 2 },
    { estado: 'En Proceso', cantidad: 0 },
    { estado: 'Completada', cantidad: 1 },
  ]),
  instalaciones: modulo(1, [
    { estado: 'Programada', cantidad: 1 },
    { estado: 'En Proceso', cantidad: 0 },
    { estado: 'Completada', cantidad: 0 },
  ]),
  cotizaciones: modulo(4, [
    { estado: 'EN PROCESO', cantidad: 0 },
    { estado: 'GENERADA', cantidad: 2 },
    { estado: 'ACEPTADA', cantidad: 1 },
    { estado: 'RECHAZADA', cantidad: 0 },
    { estado: 'COMPLETADA', cantidad: 1 },
  ]),
  ordenes_trabajo: modulo(3, [
    { estado: 'Programada', cantidad: 1 },
    { estado: 'En Proceso', cantidad: 0 },
    { estado: 'Completada', cantidad: 2 },
  ]),
  tickets: modulo(4, [
    { estado: 'Programada', cantidad: 3 },
    { estado: 'En Proceso', cantidad: 1 },
    { estado: 'Completada', cantidad: 0 },
  ]),
};

const resumen: ResumenDashboard = {
  periodo,
  generado_en: '2026-11-04T12:00:00Z',
  financiero: indicadoresFinancieros,
  clientes,
  servicios,
  operativo,
};

const financiero: DashboardFinanciero = {
  periodo,
  generado_en: '2026-11-04T12:00:00Z',
  indicadores: indicadoresFinancieros,
  series: {
    ingresos: [
      { fecha: '2026-11-01', monto: '0.00' },
      { fecha: '2026-11-02', monto: '300.00' },
      { fecha: '2026-11-03', monto: '300.00' },
    ],
    cobros_aplicados: [
      { fecha: '2026-11-01', monto: '0.00' },
      { fecha: '2026-11-02', monto: '250.00' },
      { fecha: '2026-11-03', monto: '200.00' },
    ],
    cartera_por_vencimiento: [
      { fecha: '2026-11-10', monto: '500.00', documentos: 2 },
      { fecha: '2026-11-20', monto: '1098.74', documentos: 2 },
    ],
  },
};

const comercial: DashboardComercial = {
  periodo,
  generado_en: '2026-11-04T12:00:00Z',
  clientes,
  servicios,
  cotizaciones: operativo.cotizaciones,
  series: {
    cotizaciones: [
      { fecha: '2026-11-01', cantidad: 0 },
      { fecha: '2026-11-02', cantidad: 2 },
      { fecha: '2026-11-03', cantidad: 2 },
    ],
    importe_cotizado: [
      { fecha: '2026-11-01', monto: '0.00' },
      { fecha: '2026-11-02', monto: '1250.50' },
      { fecha: '2026-11-03', monto: '700.00' },
    ],
  },
};

const operativoRespuesta: DashboardOperativo = {
  periodo,
  generado_en: '2026-11-04T12:00:00Z',
  operativo,
  series: {
    visitas_tecnicas: [{ fecha: '2026-11-01', cantidad: 3 }],
    instalaciones: [{ fecha: '2026-11-01', cantidad: 1 }],
    cotizaciones: [{ fecha: '2026-11-01', cantidad: 4 }],
    ordenes_trabajo: [{ fecha: '2026-11-01', cantidad: 3 }],
    tickets: [{ fecha: '2026-11-01', cantidad: 4 }],
  },
};

const cajaResumen: ReporteCajaDashboard = {
  tipo: 'caja',
  titulo: 'Reporte de Caja General',
  periodo: 'mensual',
  periodo_descripcion: '01/11/2026 al 30/11/2026',
  fecha_inicio: '2026-11-01',
  fecha_fin: '2026-11-30',
  fecha_generacion: '2026-11-04T12:00:00Z',
  usuario_generador: 'Administrador Principal',
  total_movimientos: 12,
  saldo_inicial: '250.00',
  entradas: '600.00',
  salidas: '100.00',
  saldo_esperado: '750.00',
};

function eventoFecha(valor: string): Event {
  return { target: { value: valor } } as unknown as Event;
}

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let dashboardService: {
    obtenerResumen: ReturnType<typeof vi.fn>;
    obtenerFinanciero: ReturnType<typeof vi.fn>;
    obtenerComercial: ReturnType<typeof vi.fn>;
    obtenerOperativo: ReturnType<typeof vi.fn>;
    obtenerResumenCaja: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    dashboardService = {
      obtenerResumen: vi.fn().mockReturnValue(of(resumen)),
      obtenerFinanciero: vi.fn().mockReturnValue(of(financiero)),
      obtenerComercial: vi.fn().mockReturnValue(of(comercial)),
      obtenerOperativo: vi.fn().mockReturnValue(of(operativoRespuesta)),
      obtenerResumenCaja: vi.fn().mockReturnValue(of(cajaResumen)),
    };
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: dashboardService },
        {
          provide: AuthService,
          useValue: { isAdministrator: vi.fn().mockReturnValue(true) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga los endpoints y presenta tarjetas, resumen, alertas y gráficas', () => {
    expect(dashboardService.obtenerResumen).toHaveBeenCalledWith({ periodo: 'mes' });
    expect(dashboardService.obtenerFinanciero).toHaveBeenCalledWith({ periodo: 'mes' });
    expect(dashboardService.obtenerComercial).toHaveBeenCalledWith({ periodo: 'mes' });
    expect(dashboardService.obtenerOperativo).toHaveBeenCalledWith({ periodo: 'mes' });
    expect(dashboardService.obtenerResumenCaja).toHaveBeenCalledWith('mes');

    expect(component.resumen()).toEqual(resumen);
    expect(fixture.nativeElement.querySelectorAll('.metric-card').length).toBe(7);
    expect(fixture.nativeElement.querySelectorAll('.summary-card').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.financial-metric').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.alert-item').length).toBe(3);
    expect(
      fixture.nativeElement.querySelectorAll('app-dashboard-line-chart').length,
    ).toBe(4);
    expect(
      fixture.nativeElement.querySelectorAll('app-dashboard-bar-chart').length,
    ).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.operation-card').length).toBe(5);
    expect(fixture.nativeElement.textContent).toContain('RESUMEN FINANCIERO');
    expect(fixture.nativeElement.textContent).toContain('ALERTAS INTELIGENTES');
    expect(fixture.nativeElement.textContent).toContain('Cobros vencidos');
    expect(fixture.nativeElement.textContent).toContain('Servicios suspendidos');
    expect(fixture.nativeElement.textContent).toContain(
      'Instalaciones programadas pendientes',
    );
    expect(fixture.nativeElement.textContent).toContain('750.00');
    expect(fixture.nativeElement.textContent).toContain('600');
    expect(fixture.nativeElement.textContent).toContain('1,598.74');
  });

  it('recarga al cambiar de período y evita repetir el mismo filtro', () => {
    component.seleccionarPeriodo('hoy');
    expect(dashboardService.obtenerResumen).toHaveBeenLastCalledWith({ periodo: 'hoy' });
    const llamadas = dashboardService.obtenerResumen.mock.calls.length;

    component.seleccionarPeriodo('hoy');
    expect(dashboardService.obtenerResumen.mock.calls.length).toBe(llamadas);
  });

  it('valida el rango personalizado antes de solicitar datos', () => {
    const llamadas = dashboardService.obtenerResumen.mock.calls.length;
    component.seleccionarPeriodo('personalizado');

    component.actualizarFechaInicio(eventoFecha('2026-10-31'));
    component.actualizarFechaFin(eventoFecha('2026-10-01'));
    component.aplicarPersonalizado();

    expect(component.error()).toContain('posterior');
    expect(dashboardService.obtenerResumen.mock.calls.length).toBe(llamadas);
  });

  it('aplica el rango personalizado con sus fechas exactas', () => {
    component.seleccionarPeriodo('personalizado');
    component.actualizarFechaInicio(eventoFecha('2026-10-01'));
    component.actualizarFechaFin(eventoFecha('2026-10-31'));
    component.aplicarPersonalizado();

    expect(dashboardService.obtenerResumen).toHaveBeenLastCalledWith({
      periodo: 'personalizado',
      fecha_inicio: '2026-10-01',
      fecha_fin: '2026-10-31',
    });
  });

  it('no solicita Caja para rango personalizado e informa la limitación', () => {
    const llamadasCaja = dashboardService.obtenerResumenCaja.mock.calls.length;
    component.seleccionarPeriodo('personalizado');
    component.actualizarFechaInicio(eventoFecha('2026-10-01'));
    component.actualizarFechaFin(eventoFecha('2026-10-31'));
    component.aplicarPersonalizado();
    fixture.detectChanges();

    expect(dashboardService.obtenerResumenCaja.mock.calls.length).toBe(llamadasCaja);
    expect(fixture.nativeElement.textContent).toContain(
      'Rango personalizado no disponible',
    );
  });

  it('no consulta Caja sin perfil Administrador', () => {
    const auth = TestBed.inject(AuthService) as unknown as {
      isAdministrator: ReturnType<typeof vi.fn>;
    };
    auth.isAdministrator.mockReturnValue(false);
    dashboardService.obtenerResumenCaja.mockClear();
    const noAdminFixture = TestBed.createComponent(DashboardComponent);
    noAdminFixture.detectChanges();

    expect(dashboardService.obtenerResumenCaja).not.toHaveBeenCalled();
    expect(noAdminFixture.nativeElement.textContent).toContain(
      'Acceso administrativo requerido',
    );
  });

  it('muestra el estado de error cuando la API no responde', () => {
    dashboardService.obtenerResumen.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500 })),
    );
    const errorFixture = TestBed.createComponent(DashboardComponent);
    errorFixture.detectChanges();

    expect(errorFixture.componentInstance.error()).toContain('servidor');
    expect(errorFixture.nativeElement.querySelector('.error-banner')).not.toBeNull();
  });
});
