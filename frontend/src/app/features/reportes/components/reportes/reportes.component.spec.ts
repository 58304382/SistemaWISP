import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  ReporteCaja,
  ReporteCobros,
  ReporteCotizaciones,
  ReporteInstalaciones,
  ReporteSoporte,
} from '../../models/reporte.models';
import { ReportesService } from '../../services/reportes.service';
import { ReportesComponent } from './reportes.component';

describe('ReportesComponent', () => {
  let fixture: ComponentFixture<ReportesComponent>;
  let component: ReportesComponent;
  let service: {
    generarInstalaciones: ReturnType<typeof vi.fn>;
    generarCotizaciones: ReturnType<typeof vi.fn>;
    generarCobros: ReturnType<typeof vi.fn>;
    generarCaja: ReturnType<typeof vi.fn>;
    generarSoporte: ReturnType<typeof vi.fn>;
  };

  const instalaciones: ReporteInstalaciones = {
    titulo: 'Reporte de Instalaciones',
    periodo: 'semanal',
    periodo_descripcion: '19/10/2026 al 25/10/2026',
    fecha_inicio: '2026-10-19',
    fecha_fin: '2026-10-25',
    fecha_generacion: '2026-10-21T12:00:00Z',
    usuario_generador: 'Administrador Principal',
    total_instalaciones: 1,
    estados: [
      { estado: 'Programada', cantidad: 0 },
      { estado: 'En Proceso', cantidad: 0 },
      { estado: 'Completada', cantidad: 1 },
    ],
    instalaciones: [
      {
        fecha: '2026-10-21',
        cliente: 'Cliente Real',
        tipo_instalacion: 'Residencial',
        tecnico_responsable: 'Técnico Responsable',
        estado: 'Completada',
        observaciones: 'Trabajo finalizado',
      },
    ],
  };

  const cotizaciones: ReporteCotizaciones = {
    tipo: 'cotizaciones',
    titulo: 'Reporte de Cotizaciones y Proformas',
    periodo: 'mensual',
    periodo_descripcion: '01/10/2026 al 31/10/2026',
    fecha_inicio: '2026-10-01',
    fecha_fin: '2026-10-31',
    fecha_generacion: '2026-10-21T12:00:00Z',
    usuario_generador: 'Administrador Principal',
    total_cotizaciones: 1,
    pendientes: 1,
    aceptadas: 0,
    importe_total: '1250.50',
    cotizaciones: [
      {
        fecha: '2026-10-20',
        cliente: 'Cliente Cotización',
        origen: 'DIRECTA',
        estado: 'GENERADA',
        referencia: 'COT-2026-0001',
        importe: '1250.50',
      },
    ],
  };

  const cobros: ReporteCobros = {
    tipo: 'cobros',
    titulo: 'Reporte de Cobros',
    periodo: 'diario',
    periodo_descripcion: '21/10/2026',
    fecha_inicio: '2026-10-21',
    fecha_fin: '2026-10-21',
    fecha_generacion: '2026-10-21T12:00:00Z',
    usuario_generador: 'Administrador Principal',
    total_pagos: 1,
    total_cobrado: '500.00',
    conceptos: [{ concepto: 'Cotizacion COT-2026-0001', importe: '500.00' }],
    cobros: [
      {
        fecha: '2026-10-21',
        cliente: 'Cliente Pago',
        concepto: 'Cotizacion COT-2026-0001',
        metodo_pago: 'Efectivo',
        referencia: 'REF-01',
        importe: '500.00',
      },
    ],
  };

  const caja: ReporteCaja = {
    tipo: 'caja',
    titulo: 'Reporte de Caja General',
    periodo: 'semanal',
    periodo_descripcion: '19/10/2026 al 25/10/2026',
    fecha_inicio: '2026-10-19',
    fecha_fin: '2026-10-25',
    fecha_generacion: '2026-10-21T12:00:00Z',
    usuario_generador: 'Administrador Principal',
    total_movimientos: 1,
    saldo_inicial: '250.00',
    entradas: '500.00',
    salidas: '0.00',
    saldo_esperado: '750.00',
    movimientos: [
      {
        fecha: '2026-10-21',
        hora: '10:35:00',
        tipo: 'Ingreso',
        concepto: 'Pago de instalaciones',
        metodo_pago: 'Efectivo',
        referencia: null,
        responsable: 'Empleado Caja',
        importe: '500.00',
      },
    ],
  };

  const soporte: ReporteSoporte = {
    tipo: 'soporte',
    titulo: 'Reporte de Soporte Técnico',
    periodo: 'mensual',
    periodo_descripcion: '01/10/2026 al 31/10/2026',
    fecha_inicio: '2026-10-01',
    fecha_fin: '2026-10-31',
    fecha_generacion: '2026-10-21T12:00:00Z',
    usuario_generador: 'Administrador Principal',
    total_tickets: 1,
    programados: 0,
    en_proceso: 0,
    completados: 1,
    tickets: [
      {
        fecha: '2026-10-20',
        cliente: 'Cliente Soporte',
        categoria: 'Internet',
        tecnico: 'Técnico Soporte',
        estado: 'Completada',
        resultado: 'Servicio restablecido',
      },
    ],
  };

  beforeEach(async () => {
    service = {
      generarInstalaciones: vi.fn().mockReturnValue(of(instalaciones)),
      generarCotizaciones: vi.fn().mockReturnValue(of(cotizaciones)),
      generarCobros: vi.fn().mockReturnValue(of(cobros)),
      generarCaja: vi.fn().mockReturnValue(of(caja)),
      generarSoporte: vi.fn().mockReturnValue(of(soporte)),
    };
    await TestBed.configureTestingModule({
      imports: [ReportesComponent],
      providers: [{ provide: ReportesService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReportesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('muestra cinco tipos habilitados', () => {
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('select[formControlName="tipo"] option'),
    ) as HTMLOptionElement[];

    expect(options).toHaveLength(5);
    expect(options.every((option) => option.disabled === false)).toBe(true);
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Instalaciones',
      'Cotizaciones/Proformas',
      'Cobros',
      'Caja General',
      'Soporte Técnico',
    ]);
  });

  it('genera el reporte de instalaciones con una fecha de referencia', () => {
    component.form.patchValue({ periodo: 'semanal', fecha: '2026-10-21' });

    component.generarReporte();
    fixture.detectChanges();

    expect(service.generarInstalaciones).toHaveBeenCalledWith('semanal', '2026-10-21');
    expect(component.reporteInstalaciones()).toEqual(instalaciones);
    expect(fixture.nativeElement.textContent).toContain('Cliente Real');
    expect(fixture.nativeElement.textContent).toContain('Administrador Principal');
  });

  it('normaliza el mes al primer día para FastAPI', () => {
    component.form.patchValue({ periodo: 'mensual', mes: '2026-02' });

    component.generarReporte();

    expect(service.generarInstalaciones).toHaveBeenCalledWith('mensual', '2026-02-01');
  });

  it('presenta un mensaje informativo cuando no existen registros', () => {
    service.generarInstalaciones.mockReturnValue(
      of({ ...instalaciones, total_instalaciones: 0, instalaciones: [] }),
    );

    component.generarReporte();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No existen instalaciones en el período seleccionado.',
    );
  });

  it('imprime solo después de generar una vista previa', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    component.imprimir();
    expect(printSpy).not.toHaveBeenCalled();

    component.generarReporte();
    component.imprimir();

    expect(printSpy).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('printing-installation-report')).toBe(true);

    window.dispatchEvent(new Event('afterprint'));

    expect(document.body.classList.contains('printing-installation-report')).toBe(false);
  });

  it('no muestra el mensaje inferior en la vista previa', () => {
    component.generarReporte();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Reporte generado desde SistemaWISP con información registrada en PostgreSQL.',
    );
    expect(fixture.nativeElement.querySelector('.report-sheet footer')).toBeNull();
  });

  it('genera Cotizaciones con su tabla e indicadores', () => {
    component.form.patchValue({ tipo: 'cotizaciones', periodo: 'mensual', mes: '2026-10' });

    component.generarReporte();
    fixture.detectChanges();

    expect(service.generarCotizaciones).toHaveBeenCalledWith('mensual', '2026-10-01');
    expect(fixture.nativeElement.textContent).toContain('COT-2026-0001');
    expect(fixture.nativeElement.textContent).toContain('Pendientes');
    expect(fixture.nativeElement.textContent).toContain('Aceptadas');
  });

  it('genera Cobros con el desglose por concepto', () => {
    component.form.patchValue({ tipo: 'cobros', periodo: 'diario', fecha: '2026-10-21' });

    component.generarReporte();
    fixture.detectChanges();

    expect(service.generarCobros).toHaveBeenCalledWith('diario', '2026-10-21');
    expect(fixture.nativeElement.textContent).toContain('Cliente Pago');
    expect(fixture.nativeElement.textContent).toContain('Por concepto: Cotizacion COT-2026-0001');
  });

  it('genera Caja General con saldo inicial y saldo esperado', () => {
    component.form.patchValue({ tipo: 'caja', periodo: 'semanal', fecha: '2026-10-21' });

    component.generarReporte();
    fixture.detectChanges();

    expect(service.generarCaja).toHaveBeenCalledWith('semanal', '2026-10-21');
    expect(fixture.nativeElement.textContent).toContain('Saldo esperado');
    expect(fixture.nativeElement.textContent).toContain('Empleado Caja');
    expect(fixture.nativeElement.textContent).toContain('10:35');
  });

  it('genera Soporte Técnico con el resultado del trabajo', () => {
    component.form.patchValue({ tipo: 'soporte', periodo: 'mensual', mes: '2026-10' });

    component.generarReporte();
    fixture.detectChanges();

    expect(service.generarSoporte).toHaveBeenCalledWith('mensual', '2026-10-01');
    expect(fixture.nativeElement.textContent).toContain('Servicio restablecido');
    expect(fixture.nativeElement.textContent).toContain('Técnico Soporte');
  });
});
