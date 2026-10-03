import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { CotizacionesService } from '../../core/services/cotizaciones.service';
import {
  CotizacionResponseDto,
  CotizacionVista,
  DetalleCotizacionResponseDto,
  ESTADOS_COTIZACION,
  calcularResumenCotizacion,
  cotizacionResponseAVista,
  detalleFormularioADto,
  obtenerAccionesCotizacion,
} from './cotizacion.models';
import { CotizacionesComponent } from './cotizaciones.component';

const detalleCompleto = {
  id_detalle: 1,
  descripcion: 'Instalación',
  cantidad: 2,
  unidad: 'unidad',
  precio_unitario: 125,
  subtotal_detalle: 250,
};

function crearCotizacion(
  cambios: Partial<CotizacionVista> = {},
): CotizacionVista {
  return {
    id_cotizacion: 1,
    numero_cotizacion: 'COT-2026-0001',
    cliente: {
      id_cliente: 7,
      nombres: 'Ana',
      apellidos: 'López',
      telefono: '55551234',
      direccion: 'Zona 1',
      departamento: 'Guatemala',
      municipio: 'Guatemala',
    },
    fecha: '2026-09-29',
    fecha_actualizacion: '2026-09-29T10:00:00',
    estado: 'GENERADA',
    origen: 'DIRECTA',
    id_evaluacion: null,
    detalles: [detalleCompleto],
    porcentaje_descuento: 10,
    subtotal: 250,
    monto_descuento: 25,
    total: 225,
    tiene_proforma: false,
    proforma: null,
    ...cambios,
  };
}

function crearCotizacionDto(
  cambios: Partial<CotizacionResponseDto> = {},
): CotizacionResponseDto {
  const cotizacion = crearCotizacion();
  return {
    ...cotizacion,
    observaciones: null,
    porcentaje_descuento: '10.00',
    detalles: cotizacion.detalles.map((detalle) => ({
      ...detalle,
      cantidad: String(detalle.cantidad),
      precio_unitario:
        detalle.precio_unitario === null ? null : String(detalle.precio_unitario),
      subtotal_detalle: String(detalle.subtotal_detalle),
    })),
    subtotal: '250.00',
    monto_descuento: '25.00',
    total: '225.00',
    ...cambios,
  };
}

describe('CotizacionesComponent', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    accept: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    generateProforma: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const dto = crearCotizacionDto();
    service = {
      list: vi.fn().mockReturnValue(of([dto])),
      generate: vi.fn().mockReturnValue(of({ ...dto, estado: 'GENERADA' })),
      accept: vi.fn().mockReturnValue(of({ ...dto, estado: 'ACEPTADA' })),
      reject: vi.fn().mockReturnValue(of({ ...dto, estado: 'RECHAZADA' })),
      delete: vi.fn().mockReturnValue(of(undefined)),
      generateProforma: vi.fn().mockReturnValue(
        of({
          id_proforma: 4,
          fecha_generacion: '2026-09-30T10:00:00',
          cotizacion: {
            ...dto,
            estado: 'ACEPTADA',
            tiene_proforma: true,
            proforma: { id_proforma: 4, fecha_generacion: '2026-09-30T10:00:00' },
          },
        }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [CotizacionesComponent],
      providers: [provideRouter([]), { provide: CotizacionesService, useValue: service }],
    }).compileComponents();
  });

  it('renderiza gestión, toolbar única, columnas exactas y sin filtros de fecha', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const headings = Array.from(element.querySelectorAll('th')).map((th) => th.textContent?.trim());

    expect(element.textContent).toContain('Cotizaciones y Proformas');
    expect(element.querySelectorAll('.quotes-toolbar')).toHaveLength(1);
    expect(headings).toEqual(['NO. COTIZACIÓN', 'CLIENTE', 'ORIGEN', 'FECHA', 'TOTAL', 'ESTADO', 'PROFORMA', 'ACCIONES']);
    expect(element.querySelector('input[type="date"]')).toBeNull();
    expect(element.querySelector('a[routerLink="/cotizaciones/nueva"]')).not.toBeNull();
  });

  it('limita los estados a los cinco definidos y filtra por cliente', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.componentInstance.cotizaciones.set([crearCotizacion()]);
    fixture.componentInstance.busqueda.set('ana lopez');
    fixture.detectChanges();

    expect(ESTADOS_COTIZACION).toEqual(['EN PROCESO', 'GENERADA', 'ACEPTADA', 'RECHAZADA', 'COMPLETADA']);
    expect(ESTADOS_COTIZACION).not.toContain('PAGADA' as never);
    expect(fixture.componentInstance.cotizacionesFiltradas()).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('COT-2026-0001');
  });

  it('EN PROCESO permite ver, editar, generar al completar precios y rechazar', () => {
    const cotizacion = crearCotizacion({ estado: 'EN PROCESO', origen: 'EVALUACION' });

    expect(obtenerAccionesCotizacion(cotizacion)).toEqual([
      'VER',
      'EDITAR',
      'GENERAR_COTIZACION',
      'RECHAZAR',
    ]);
    expect(obtenerAccionesCotizacion(cotizacion)).not.toContain('ELIMINAR');
    expect(obtenerAccionesCotizacion(cotizacion)).not.toContain('ACEPTAR');
  });

  it('EN PROCESO bloquea Generar Cotización cuando falta un precio', () => {
    const cotizacion = crearCotizacion({
      estado: 'EN PROCESO',
      origen: 'EVALUACION',
      detalles: [{ ...detalleCompleto, precio_unitario: null, subtotal_detalle: 0 }],
    });

    expect(obtenerAccionesCotizacion(cotizacion)).toEqual(['VER', 'EDITAR', 'RECHAZAR']);
  });

  it('no ofrece Generar Cotización a una combinación EN PROCESO DIRECTA', () => {
    const cotizacion = crearCotizacion({ estado: 'EN PROCESO', origen: 'DIRECTA' });

    expect(obtenerAccionesCotizacion(cotizacion)).toEqual(['VER', 'EDITAR', 'RECHAZAR']);
  });

  it('GENERADA DIRECTA muestra eliminar y EVALUACION lo bloquea', () => {
    const directa = crearCotizacion({ estado: 'GENERADA', origen: 'DIRECTA' });
    const evaluacion = crearCotizacion({ estado: 'GENERADA', origen: 'EVALUACION', id_evaluacion: 4 });

    expect(obtenerAccionesCotizacion(directa)).toEqual([
      'VER',
      'EDITAR',
      'ACEPTAR',
      'RECHAZAR',
      'ELIMINAR',
    ]);
    expect(obtenerAccionesCotizacion(evaluacion)).toEqual([
      'VER',
      'EDITAR',
      'ACEPTAR',
      'RECHAZAR',
    ]);
  });

  it('ACEPTADA alterna exclusivamente entre generar y ver Proforma', () => {
    const sinProforma = crearCotizacion({ estado: 'ACEPTADA' });
    const conProforma = crearCotizacion({
      estado: 'ACEPTADA',
      tiene_proforma: true,
      proforma: { id_proforma: 9, fecha_generacion: '2026-09-30T10:00:00' },
    });

    expect(obtenerAccionesCotizacion(sinProforma)).toEqual(['VER', 'GENERAR_PROFORMA']);
    expect(obtenerAccionesCotizacion(conProforma)).toEqual(['VER', 'VER_PROFORMA']);
    expect(obtenerAccionesCotizacion(conProforma)).not.toContain('EDITAR');
    expect(obtenerAccionesCotizacion(conProforma)).not.toContain('ELIMINAR');
  });

  it('RECHAZADA queda cerrada y solo permite ver', () => {
    expect(obtenerAccionesCotizacion(crearCotizacion({ estado: 'RECHAZADA' }))).toEqual(['VER']);
  });

  it('COMPLETADA solo agrega Ver Proforma cuando existe', () => {
    const sinProforma = crearCotizacion({ estado: 'COMPLETADA' });
    const conProforma = crearCotizacion({ estado: 'COMPLETADA', tiene_proforma: true });

    expect(obtenerAccionesCotizacion(sinProforma)).toEqual(['VER']);
    expect(obtenerAccionesCotizacion(conProforma)).toEqual(['VER', 'VER_PROFORMA']);
    expect(obtenerAccionesCotizacion(conProforma)).not.toContain('EDITAR');
    expect(obtenerAccionesCotizacion(conProforma)).not.toContain('GENERAR_PROFORMA');
  });

  it('acepta después de confirmar y sincroniza la respuesta backend', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    const cotizacion = crearCotizacion();
    fixture.componentInstance.cotizaciones.set([cotizacion]);
    fixture.componentInstance.solicitarConfirmacion(cotizacion, 'ACEPTAR');

    expect(fixture.componentInstance.confirmacionAccion()?.accion).toBe('ACEPTAR');
    fixture.componentInstance.confirmarAccion();
    expect(fixture.componentInstance.confirmacionAccion()).toBeNull();
    expect(service.accept).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.cotizaciones()[0].estado).toBe('ACEPTADA');
    expect(fixture.componentInstance.mensajeAccion()).toContain('aceptada correctamente');
  });

  it('expone loading hasta que finaliza el GET', () => {
    const response = new Subject<CotizacionResponseDto[]>();
    service.list.mockReturnValue(response);
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.cargando()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Cargando cotizaciones');
    response.next([]);
    response.complete();
    fixture.detectChanges();
    expect(fixture.componentInstance.cargando()).toBe(false);
  });

  it('distingue lista vacía y error de carga', () => {
    service.list.mockReturnValue(of([]));
    let fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay cotizaciones registradas');

    service.list.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { detail: 'Sin permiso' } })),
    );
    fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.errorCarga()).toContain('No tienes permisos');
  });

  it('rechaza y genera una evaluación sin anticipar el estado', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const evaluacion = crearCotizacion({ estado: 'EN PROCESO', origen: 'EVALUACION' });
    fixture.componentInstance.cotizaciones.set([evaluacion]);

    fixture.componentInstance.generarCotizacion(evaluacion);
    expect(service.generate).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.cotizaciones()[0].estado).toBe('GENERADA');

    const generada = fixture.componentInstance.cotizaciones()[0];
    fixture.componentInstance.solicitarConfirmacion(generada, 'RECHAZAR');
    fixture.componentInstance.confirmarAccion();
    expect(service.reject).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.cotizaciones()[0].estado).toBe('RECHAZADA');
  });

  it('elimina DIRECTA GENERADA solo después de respuesta exitosa', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const cotizacion = crearCotizacion();
    fixture.componentInstance.cotizaciones.set([cotizacion]);
    fixture.componentInstance.solicitarConfirmacion(cotizacion, 'ELIMINAR');
    fixture.componentInstance.confirmarAccion();

    expect(service.delete).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.cotizaciones()).toEqual([]);
  });

  it('un conflicto DELETE conserva el registro local', () => {
    service.delete.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { detail: 'Tiene dependencias' } }),
      ),
    );
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const cotizacion = crearCotizacion();
    fixture.componentInstance.cotizaciones.set([cotizacion]);
    fixture.componentInstance.solicitarConfirmacion(cotizacion, 'ELIMINAR');
    fixture.componentInstance.confirmarAccion();

    expect(fixture.componentInstance.cotizaciones()).toHaveLength(1);
    expect(fixture.componentInstance.mensajeAccion()).toBe('Tiene dependencias');
  });

  it('genera Proforma y cambia la acción visible a Ver Proforma', () => {
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const cotizacion = crearCotizacion({ estado: 'ACEPTADA' });
    fixture.componentInstance.cotizaciones.set([cotizacion]);
    fixture.componentInstance.solicitarConfirmacion(cotizacion, 'GENERAR_PROFORMA');
    fixture.componentInstance.confirmarAccion();

    const actualizada = fixture.componentInstance.cotizaciones()[0];
    expect(service.generateProforma).toHaveBeenCalledOnce();
    expect(actualizada.tiene_proforma).toBe(true);
    expect(fixture.componentInstance.acciones(actualizada)).toEqual(['VER', 'VER_PROFORMA']);
  });

  it('protege una transición contra doble clic', () => {
    const response = new Subject<CotizacionResponseDto>();
    service.accept.mockReturnValue(response);
    const fixture = TestBed.createComponent(CotizacionesComponent);
    fixture.detectChanges();
    const cotizacion = crearCotizacion();
    fixture.componentInstance.solicitarConfirmacion(cotizacion, 'ACEPTAR');

    fixture.componentInstance.confirmarAccion();
    fixture.componentInstance.confirmarAccion();

    expect(service.accept).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.operacionActiva()).not.toBeNull();
    response.next(crearCotizacionDto({ estado: 'ACEPTADA' }));
    response.complete();
  });

  it('admite precio null en respuesta y conserva los totales autoritativos', () => {
    const detalle: DetalleCotizacionResponseDto = {
      id_detalle: 1,
      descripcion: 'Instalación',
      cantidad: '2.00',
      unidad: 'unidad',
      precio_unitario: null,
      subtotal_detalle: '0.00',
    };
    const dto = crearCotizacionDto({
      estado: 'EN PROCESO',
      origen: 'EVALUACION',
      detalles: [detalle],
    });

    const vista = cotizacionResponseAVista(dto);
    expect(vista.detalles[0].precio_unitario).toBeNull();
    expect(vista.total).toBe(225);
  });

  it('excluye idTemporal del DTO preparado para backend', () => {
    const dto = detalleFormularioADto({
      idTemporal: 99,
      descripcion: ' Servicio ',
      cantidad: 1,
      unidad: ' unidad ',
      precio_unitario: null,
    });

    expect(dto).toEqual({
      descripcion: 'Servicio',
      cantidad: 1,
      unidad: 'unidad',
      precio_unitario: null,
    });
    expect('idTemporal' in dto).toBe(false);
  });

  it('calcula valores locales sin IVA y trata un precio pendiente como cero visual', () => {
    const resumen = calcularResumenCotizacion(
      [
        { cantidad: 2, precio_unitario: 100 },
        { cantidad: 1, precio_unitario: null },
      ],
      10,
    );

    expect(resumen).toEqual({ subtotal: 200, descuento: 20, total: 180 });
  });
});
