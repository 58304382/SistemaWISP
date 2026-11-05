import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { AuthService } from '../../../auth/services/auth.service';
import { Usuario } from '../../../usuarios/models/usuario.models';

import {
  CategoriaCaja,
  ConciliacionCaja,
  EntregaEmpleado,
  CierreCajaResponse,
  FiltrosMovimientosCaja,
  MetodoPagoCaja,
  MovimientoCajaDetalle,
  SesionCajaActual,
} from '../../models/caja.models';
import { CajaService } from '../../services/caja.service';
import { CobrosService } from '../../services/cobros.service';
import { CajaGeneralComponent } from './caja-general.component';

const sesion: SesionCajaActual = {
  id_sesion: 12,
  id_empleado: 7,
  fecha_apertura: '2026-10-15T08:30:00',
  fecha_cierre: null,
  saldo_inicial: '250.00',
  saldo_final: null,
  estado: 'Abierta',
  efectivo_disponible: '375.50',
};

const conciliacionBase: ConciliacionCaja = {
  id_sesion: 12, saldo_inicial: '250.00', cobros: [], recibido_directamente: 0,
  entradas_efectivo: '125.50', salidas_efectivo: 0, total_efectivo: 0, total_transferencias: 0,
  total_entregado: 0, gastos_autorizados: 0, pendiente_entrega: 0,
  historicos: [], efectivo_sin_clasificar: 0, efectivo_confirmado: '375.50', efectivo_esperado: '375.50', empleados: [],
};

const conPendiente: ConciliacionCaja = {
  ...conciliacionBase, entradas_efectivo: 100, total_efectivo: 100,
  pendiente_entrega: 100, efectivo_esperado: 250, efectivo_confirmado: 250,
  empleados: [{ id_empleado: 9, codigo: 'COB-009', empleado: 'Cobrador Real', recaudado: 100, entregado: 0, gastos: 0, pendiente: 100,
    pagos_pendientes: [{ id_pago: 10, id_cliente: 4, cliente: 'Cliente Real', origen: 'INTERNET', fecha_hora: '2026-10-20T12:00:00',
      monto_recaudado: 100, monto_entregado: 0, gastos_autorizados: 0, pendiente: 100 }] }],
};

const entregaConfirmada: EntregaEmpleado = {
  id_entrega: 1, id_sesion: 12, id_empleado: 9, empleado: 'Cobrador Real', id_administrativo: 7,
  responsable_recepcion: 'Ana Pérez', fecha_hora: '2026-10-21T18:00:00', monto_entregado: 80,
  recaudado: 100, gastos_autorizados: 20, observaciones: null,
  pagos: [{ id_pago: 10, cliente: 'Cliente Real', origen: 'INTERNET', monto_entregado: 80, monto_gasto_autorizado: 20 }],
  gastos: [{ concepto: 'Gasolina', monto: 20, observaciones: null }],
};

// Respuesta simulada: ninguna prueba invoca endpoints financieros reales.
const cierre: CierreCajaResponse = {
  ...sesion,
  estado: 'Cerrada',
  saldo_final: '375.50',
  fecha_cierre: '2026-10-20T18:30:00',
  arqueo: {
    id_arqueo: 91, id_sesion: 12, monto_sistema: '375.50', monto_contado: '375.50',
    diferencia: '0.00', observaciones: null, fecha_hora: '2026-10-20T18:30:00',
  },
};

const categorias: CategoriaCaja[] = [
  {
    id_categoria: 2,
    nombre: 'Entrada',
    tipo: 'Ingreso',
    descripcion: 'Movimiento manual de entrada',
    estado: 'Activo',
  },
  {
    id_categoria: 3,
    nombre: 'Salida',
    tipo: 'Egreso',
    descripcion: 'Movimiento manual de salida',
    estado: 'Activo',
  },
];

const metodos: MetodoPagoCaja[] = [
  {
    id_metodo_pago: 1,
    nombre: 'Efectivo',
    descripcion: null,
    estado: 'Activo',
  },
  {
    id_metodo_pago: 2,
    nombre: 'Transferencia',
    descripcion: null,
    estado: 'Activo',
  },
];

const movimiento: MovimientoCajaDetalle = {
  id_movimiento: 31,
  id_sesion: 12,
  id_categoria: 2,
  id_metodo_pago: 1,
  id_responsable: 7,
  tipo: 'Ingreso',
  concepto: 'Entrada confirmada',
  monto: '125.50',
  referencia: null,
  id_salida_producto: null,
  observaciones: 'Recibido en ventanilla',
  fecha_hora: '2026-10-15T09:10:00',
  categoria: 'Entrada',
  metodo_pago: 'Efectivo',
  responsable: 'Ana Pérez',
  es_efectivo: true,
};

describe('CajaGeneralComponent', () => {
  let fixture: ComponentFixture<CajaGeneralComponent>;
  let usuarioAutenticado: WritableSignal<Usuario | null>;
  let cajaService: {
    obtenerSesionActual: ReturnType<typeof vi.fn>;
    listarCategorias: ReturnType<typeof vi.fn>;
    listarMetodosPago: ReturnType<typeof vi.fn>;
    listarMovimientos: ReturnType<typeof vi.fn>;
    registrarMovimiento: ReturnType<typeof vi.fn>;
    abrir: ReturnType<typeof vi.fn>;
    cerrar: ReturnType<typeof vi.fn>;
    conciliacion: ReturnType<typeof vi.fn>;
    registrarEntrega: ReturnType<typeof vi.fn>;
    listarEntregas: ReturnType<typeof vi.fn>;
    detalleEntrega: ReturnType<typeof vi.fn>;
  };
  let cobrosService: {
    listarEmpleadosReceptores: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    usuarioAutenticado = signal<Usuario | null>({
      id: 1, nombre: 'Ana', apellido: 'Pérez', username: 'admin', rol_id: 1,
      activo: true, created_at: null, updated_at: null,
      rol: { id: 1, nombre: 'Administrador' },
      modulos: [{ id: 1, nombre: 'Caja', codigo: 'caja', activo: true }],
      empleado: { id_empleado: 7, codigo: 'EMP-7', nombres: 'Ana', apellidos: 'Pérez', puesto: { id_puesto: 1, nombre: 'Administración' } },
    });
    cajaService = {
      obtenerSesionActual: vi.fn().mockReturnValue(of(sesion)),
      listarCategorias: vi.fn((tipo: CategoriaCaja['tipo']) =>
        of(categorias.filter((categoria) => categoria.tipo === tipo)),
      ),
      listarMetodosPago: vi.fn().mockReturnValue(of(metodos)),
      listarMovimientos: vi
        .fn()
        .mockReturnValue(
          of({ items: [movimiento], total: 1, page: 1, page_size: 25, total_pages: 1 }),
        ),
      registrarMovimiento: vi.fn().mockReturnValue(of(movimiento)),
      abrir: vi.fn().mockReturnValue(of(sesion)),
      cerrar: vi.fn().mockReturnValue(of(cierre)),
      conciliacion: vi.fn().mockReturnValue(of(conciliacionBase)),
      registrarEntrega: vi.fn().mockReturnValue(of()),
      listarEntregas: vi.fn().mockReturnValue(of([])),
      detalleEntrega: vi.fn().mockReturnValue(of()),
    };
    cobrosService = {
      listarEmpleadosReceptores: vi.fn().mockReturnValue(of([
        { id_empleado: 9, codigo: 'COB-009', nombres: 'Cobrador', apellidos: 'Real' },
      ])),
    };

    await TestBed.configureTestingModule({
      imports: [CajaGeneralComponent],
      providers: [provideRouter([]),
        { provide: CajaService, useValue: cajaService },
        { provide: CobrosService, useValue: cobrosService }, {
        provide: AuthService,
        useValue: {
          currentUser: usuarioAutenticado,
          isAdministrator: () => usuarioAutenticado()?.rol.nombre === 'Administrador',
          hasModule: (codigo: string) => usuarioAutenticado()?.modulos.some((modulo) => modulo.codigo === codigo && modulo.activo) ?? false,
        },
      }],
    }).compileComponents();

    fixture = TestBed.createComponent(CajaGeneralComponent);
  });

  afterEach(() => vi.restoreAllMocks());

  it('ignora conciliaciones e historiales antiguos incluso dentro de la misma sesión', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const anterior = new Subject<ConciliacionCaja>();
    const vigente = new Subject<ConciliacionCaja>();
    cajaService.conciliacion.mockReturnValueOnce(anterior).mockReturnValueOnce(vigente);
    component.cargarConciliacion();
    component.cargarConciliacion();
    anterior.next(conciliacionBase);
    anterior.complete();
    expect(component.cargandoConciliacion()).toBe(true);
    expect(component.puedeCerrarCaja()).toBe(false);
    vigente.next(conPendiente);
    vigente.complete();
    expect(component.conciliacion()?.pendiente_entrega).toBe(100);
    const historialAnterior = new Subject<EntregaEmpleado[]>();
    const historialVigente = new Subject<EntregaEmpleado[]>();
    cajaService.listarEntregas.mockReturnValueOnce(historialAnterior).mockReturnValueOnce(historialVigente);
    component.cargarHistorialEntregas();
    component.cargarHistorialEntregas();
    historialVigente.next([entregaConfirmada]);
    historialAnterior.next([]);
    expect(component.historialEntregas()).toEqual([entregaConfirmada]);
    historialVigente.complete();
    historialAnterior.complete();
    cajaService.obtenerSesionActual.mockReturnValue(throwError(() => new Error('Sin conexión')));
    component.cargarSesion();
    expect(component.conciliacion()).toBeNull();
    expect(component.entregaValida()).toBe(false);
    expect(component.puedeCerrarCaja()).toBe(false);
  });

  it('confirma empleado y gastos, actualiza el arqueo y no solicita otro ingreso manual', () => {
    cajaService.conciliacion.mockReturnValue(of(conPendiente));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.puedeCerrarCaja()).toBe(false);
    component.abrirCierreEmpleado();
    const selector = document.createElement('select');
    selector.add(new Option('Cobrador Real', '9'));
    component.seleccionarEmpleadoEntrega({ target: selector } as unknown as Event);
    expect(component.recaudadoEntrega()).toBe(100);
    expect(component.montoEntrega()).toBe('100.00');
    component.agregarGastoEntrega();
    const input = document.createElement('input');
    input.value = 'Gasolina';
    component.actualizarGastoEntrega(0, 'concepto', { target: input } as unknown as Event);
    input.value = '20';
    component.actualizarGastoEntrega(0, 'monto', { target: input } as unknown as Event);
    expect(component.montoEntrega()).toBe('80.00');
    expect(component.efectivoRecibidoEntrega()).toBe(80);
    expect(component.diferenciaEntrega()).toBe(0);
    expect(component.entregaValida()).toBe(false);
    component.autorizarGastosEntrega.set(true);
    const respuesta = new Subject<EntregaEmpleado>();
    cajaService.registrarEntrega.mockReturnValue(respuesta);
    component.confirmarEntrega(new Event('submit'));
    component.confirmarEntrega(new Event('submit'));
    expect(cajaService.registrarEntrega).toHaveBeenCalledOnce();
    const payload = cajaService.registrarEntrega.mock.calls[0][0];
    expect(payload).toMatchObject({ id_empleado: 9, ids_pagos: [10], monto_entregado: 80, autorizar_gastos: true,
      gastos: [{ concepto: 'Gasolina', monto: 20, observaciones: null }] });
    expect(payload).not.toHaveProperty('id_administrativo');
    cajaService.conciliacion.mockReturnValue(of({ ...conciliacionBase, efectivo_esperado: 330, total_entregado: 80, gastos_autorizados: 20 }));
    cajaService.listarEntregas.mockReturnValue(of([entregaConfirmada]));
    cajaService.detalleEntrega.mockReturnValue(of(entregaConfirmada));
    respuesta.next(entregaConfirmada);
    respuesta.complete();
    expect(component.efectivoEsperado()).toBe(330);
    expect(component.puedeCerrarCaja()).toBe(true);
    expect(component.historialEntregas()).toHaveLength(1);
    component.verEntrega(1);
    expect(component.entregaSeleccionada()?.responsable_recepcion).toBe('Ana Pérez');
    expect(cajaService.registrarMovimiento).not.toHaveBeenCalled();
    expect(cajaService.cerrar).not.toHaveBeenCalled();
  });

  it('busca empleados activos por nombre, apellido o código y combina su conciliación', () => {
    const segundo = {
      ...conPendiente.empleados[0], id_empleado: 10, codigo: 'COB-Á10', empleado: 'José Pérez',
      pagos_pendientes: [{ ...conPendiente.empleados[0].pagos_pendientes[0], id_pago: 11 }],
    };
    cajaService.conciliacion.mockReturnValue(of({
      ...conPendiente,
      pendiente_entrega: 200,
      empleados: [conPendiente.empleados[0], segundo],
    }));
    cobrosService.listarEmpleadosReceptores.mockReturnValue(of([
      { id_empleado: 9, codigo: 'COB-009', nombres: 'Cobrador', apellidos: 'Real' },
      { id_empleado: 10, codigo: 'COB-Á10', nombres: 'José', apellidos: 'Pérez' },
    ]));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirCierreEmpleado();

    const buscador = document.createElement('input');
    buscador.value = 'jose perez';
    component.actualizarBusquedaEmpleadoEntrega({ target: buscador } as unknown as Event);
    expect(component.empleadosEntregaFiltrados().map(item => item.id_empleado)).toEqual([10]);

    buscador.value = 'cob-a10';
    component.actualizarBusquedaEmpleadoEntrega({ target: buscador } as unknown as Event);
    expect(component.empleadosEntregaFiltrados().map(item => item.id_empleado)).toEqual([10]);
    expect(cajaService.conciliacion).toHaveBeenCalledTimes(2);
    expect(cobrosService.listarEmpleadosReceptores).toHaveBeenCalledOnce();
    expect(component.empleadosEntrega().find(item => item.id_empleado === 10)?.pendiente).toBe(100);
  });

  it('muestra empleados activos sin cobros con saldo cero y bloquea la entrega', () => {
    cobrosService.listarEmpleadosReceptores.mockReturnValue(of([
      { id_empleado: 12, codigo: 'EMP-012', nombres: 'María', apellidos: 'López' },
    ]));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirCierreEmpleado();

    expect(component.empleadosEntrega()).toEqual([{
      id_empleado: 12, codigo: 'EMP-012', empleado: 'María López', pendiente: 0,
    }]);
    component.seleccionarEmpleadoEntregaPorId(12);
    fixture.detectChanges();

    expect(component.empleadoEntrega()).toBeNull();
    expect(component.pagosEntrega().size).toBe(0);
    expect(component.entregaValida()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No hay pagos pendientes para el empleado seleccionado');
    expect((fixture.nativeElement as HTMLElement).querySelector('.collector-card')?.textContent).toContain('0.00');
  });

  it('limpia el cierre y mantiene bloqueada una entrega sin cobros seleccionados', () => {
    cajaService.conciliacion.mockReturnValue(of(conPendiente));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirCierreEmpleado();
    component.seleccionarEmpleadoEntregaPorId(9);
    component.agregarGastoEntrega();
    component.observacionesEntrega.set('Entrega parcial');

    component.limpiarCierreEmpleado();

    expect(component.empleadoEntregaId()).toBeNull();
    expect(component.pagosEntrega().size).toBe(0);
    expect(component.gastosEntrega()).toEqual([]);
    expect(component.montoEntrega()).toBe('');
    expect(component.entregaValida()).toBe(false);
    component.confirmarEntrega(new Event('submit'));
    expect(cajaService.registrarEntrega).not.toHaveBeenCalled();
  });

  it('mantiene la misma clave al reintentar una entrega sin cambiar los datos', () => {
    cajaService.conciliacion.mockReturnValue(of(conPendiente));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirCierreEmpleado();
    const selector = document.createElement('select');
    selector.add(new Option('Cobrador', '9'));
    component.seleccionarEmpleadoEntrega({ target: selector } as unknown as Event);
    cajaService.registrarEntrega.mockReturnValue(throwError(() => new Error('Red interrumpida')));
    component.confirmarEntrega(new Event('submit'));
    component.confirmarEntrega(new Event('submit'));
    expect(cajaService.registrarEntrega.mock.calls[0][0].clave_idempotencia)
      .toBe(cajaService.registrarEntrega.mock.calls[1][0].clave_idempotencia);
  });

  it('separa históricos y bloquea el cierre sin atribuirlos al aperturista', () => {
    cajaService.conciliacion.mockReturnValue(of({ ...conciliacionBase,
      efectivo_esperado: null, efectivo_sin_clasificar: 300,
      historicos: [{ ...conPendiente.empleados[0].pagos_pendientes[0], monto_recaudado: 300 }],
    }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.seleccionarPestana('Cierre');
    fixture.detectChanges();
    expect(component.efectivoEsperado()).toBeNull();
    expect(component.puedeCerrarCaja()).toBe(false);
    component.abrirModalCierre();
    fixture.detectChanges();
    expect(component.modalCierreAbierto()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Caja con pagos históricos pendientes');
    expect((fixture.nativeElement.querySelector('.cash-closing-modal button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('sin clasificación');
    expect(component.empleadosPendientes()).toEqual([]);
    component.abrirCierreEmpleado();
    fixture.detectChanges();
    expect(component.modalEntregaAbierto()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('No hay cobros clasificados por empleado');
    expect(fixture.nativeElement.textContent).not.toContain('No hay pagos pendientes para el empleado seleccionado');
    expect(cajaService.cerrar).not.toHaveBeenCalled();
  });

  it('distingue un error de conciliación de la ausencia real de pendientes', () => {
    cajaService.conciliacion.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirCierreEmpleado();
    fixture.detectChanges();
    expect(component.errorConciliacion()).not.toBe('');
    expect(fixture.nativeElement.textContent).toContain('No fue posible cargar los cobros pendientes');
    expect(fixture.nativeElement.textContent).not.toContain('No hay cobros pendientes registrados por empleados');
  });

  it('carga sesión, movimientos y catálogos con autorización de Caja', () => {
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(cajaService.obtenerSesionActual).toHaveBeenCalledOnce();
    expect(cajaService.listarCategorias).toHaveBeenCalledWith('Ingreso');
    expect(cajaService.listarCategorias).toHaveBeenCalledWith('Egreso');
    expect(cajaService.listarMetodosPago).toHaveBeenCalledOnce();
    expect(cajaService.listarMovimientos).toHaveBeenCalledWith(
      expect.objectContaining({ id_sesion: 12, page: 1, page_size: 25 }),
    );
    expect(root.textContent).toContain('CAJA ABIERTA');
    expect(root.textContent).toContain('Entrada confirmada');
  });

  it('conserva las columnas compactas y habilita el alta solo con catálogos activos', () => {
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const encabezados = Array.from(root.querySelectorAll('thead th')).map((item) =>
      item.textContent?.trim(),
    );

    expect(encabezados).toEqual(['Fecha', 'Concepto', 'Tipo', 'Monto']);
    const botonEntrada = root.querySelector('.cash-actions button') as HTMLButtonElement;
    expect(botonEntrada.disabled).toBe(false);
    // Las cuatro acciones principales están presentes con nombres uniformes.
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Registrar entrada');
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Registrar salida');
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Cierre de cobros por empleado');
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Cerrar caja');
  });

  it('mantiene bloqueado el registro cuando no existen métodos activos', () => {
    cajaService.listarMetodosPago.mockReturnValue(of([]));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const botonEntrada = root.querySelector('.cash-actions button.primary-button') as HTMLButtonElement;
    expect(botonEntrada.disabled).toBe(true);
    expect(root.textContent).toContain('Sin métodos de pago activos');
  });

  it('mantiene bloqueado el registro cuando las categorías manuales están vacías', () => {
    cajaService.listarCategorias.mockReturnValue(of([]));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const botonEntrada = root.querySelector('.cash-actions button.primary-button') as HTMLButtonElement;
    expect(botonEntrada.disabled).toBe(true);
    expect(root.textContent).toContain('Sin categorías manuales activas');
  });

  it('no consulta catálogos ni movimientos cuando no existe sesión activa', () => {
    cajaService.obtenerSesionActual.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    fixture.detectChanges();

    expect(cajaService.listarCategorias).not.toHaveBeenCalled();
    expect(cajaService.listarMetodosPago).not.toHaveBeenCalled();
    expect(cajaService.listarMovimientos).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CAJA SIN SESIÓN ABIERTA');
  });

  it('informa el error de catálogos y ofrece un reintento independiente', () => {
    cajaService.listarMetodosPago.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('No fue posible consultar los catálogos');
    expect(root.textContent).toContain('No tienes permisos para realizar esta acción');
    const botonEntrada = root.querySelector('.cash-actions button.primary-button') as HTMLButtonElement;
    expect(botonEntrada.disabled).toBe(true);
  });

  it('registra una entrada en efectivo con IDs reales y opcionales nulos', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirModalMovimiento();
    component.conceptoMovimiento.set('Aporte de caja');
    component.montoMovimiento.set('25.50');

    component.confirmarMovimiento(new Event('submit'));

    expect(cajaService.registrarMovimiento).toHaveBeenCalledWith({
      tipo: 'Ingreso',
      id_categoria: 2,
      concepto: 'Aporte de caja',
      monto: 25.5,
      id_metodo_pago: 1,
      referencia: null,
      observaciones: null,
    });
    expect(cajaService.obtenerSesionActual).toHaveBeenCalledTimes(2);
    expect(component.modalMovimientoAbierto()).toBe(false);
    expect(component.mensajeExito()).toContain('registrado correctamente');
  });

  it('exige referencia para transferencia y conserva el modal ante conflicto', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirModalMovimiento();
    component.idMetodoMovimiento.set(2);
    component.conceptoMovimiento.set('Transferencia recibida');
    component.montoMovimiento.set('80.00');

    expect(component.formularioMovimientoValido()).toBe(false);
    component.referenciaMovimiento.set('TRX-100');
    expect(component.formularioMovimientoValido()).toBe(true);

    cajaService.registrarMovimiento.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              detail: {
                mensaje: 'La solicitud repite un movimiento ya confirmado',
                id_movimiento: 8,
              },
            },
          }),
      ),
    );
    component.confirmarMovimiento(new Event('submit'));

    expect(component.modalMovimientoAbierto()).toBe(true);
    expect(component.errorOperacion()).toContain('movimiento #8');
  });

  it('filtra por tipo y abre el detalle inmutable', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.filtroTipo.set('Ingreso');
    component.aplicarFiltros();

    expect(cajaService.listarMovimientos).toHaveBeenLastCalledWith(
      expect.objectContaining({ id_sesion: 12, tipo: 'Ingreso' }),
    );
    component.verDetalle(movimiento);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Movimiento #31');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Recibido en ventanilla');
  });

  // Regresión: el resumen incluye otras páginas y métodos, sin heredar filtros del listado.
  it('calcula importes y contadores de toda la sesión aunque el listado esté filtrado', () => {
    cajaService.conciliacion.mockReturnValue(of({ ...conciliacionBase, efectivo_esperado: '350.40' }));
    cajaService.listarMovimientos.mockImplementation((filtros: FiltrosMovimientosCaja) => {
      const items = filtros.tipo ? [movimiento] : filtros.page === 1 ? [movimiento] : [
        { ...movimiento, id_movimiento: 32, tipo: 'Egreso', monto: '25.10' },
        { ...movimiento, id_movimiento: 33, monto: '0.20', es_efectivo: false, categoria: 'Cobro de instalaciones' },
      ];
      return of({ items, total: filtros.tipo ? 1 : 3, page: filtros.page, page_size: 25, total_pages: filtros.tipo ? 1 : 2 });
    });
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.resumenSesion()).toEqual({ entradas: 12570, salidas: 2510, cantidadEntradas: 2, cantidadSalidas: 1, entradasEfectivo: 12550, salidasEfectivo: 2510 });
    expect(component.saldoEsperado()).toBe(350.60);
    expect(component.efectivoEsperado()).toBe(350.40);
    expect(component.movimientos()).toEqual([movimiento]);
    expect(cajaService.listarMovimientos).toHaveBeenCalledWith({ page: 2, page_size: 25, id_sesion: 12 });

    component.fechaDesde.set('2026-10-15');
    component.seleccionarPestana('Salidas');
    expect(cajaService.listarMovimientos).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: 'Egreso', fecha_desde: '2026-10-15', page: 1 }));
    expect(component.saldoEsperado()).toBe(350.60);
    component.limpiarFiltros();
    expect(component.filtroTipo()).toBe('Egreso');
  });

  it('no publica totales parciales si falla una página del resumen', () => {
    cajaService.listarMovimientos.mockImplementation((filtros: FiltrosMovimientosCaja) => {
      if (filtros.page === 2) return throwError(() => new Error('Consulta interrumpida'));
      return of({ items: [movimiento], total: 2, page: 1, page_size: 25, total_pages: 2 });
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.resumenSesion()).toBeNull();
    expect(fixture.componentInstance.saldoEsperado()).toBeNull();
    expect(fixture.componentInstance.errorResumen()).not.toBe('');
    expect(fixture.nativeElement.textContent).toContain('Reintentar resumen');
  });

  it('muestra información real y mantiene independientes los dos cierres', () => {
    fixture.detectChanges();
    fixture.componentInstance.seleccionarPestana('Cierre');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Sesión #12');
    expect(root.textContent).toContain('15/10/2026');
    expect(root.textContent).toContain('Empleado #7');
    expect(root.textContent).toContain('CAJA ABIERTA');
    expect(root.textContent).toContain('Cierre de cobros por empleado');
    expect(root.querySelector('.close-cash-button')?.textContent).toContain('Cerrar caja');
    expect(root.querySelector('table')).not.toBeNull();
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Registrar entrada');
    expect(root.querySelector('.cash-actions')?.textContent).toContain('Registrar salida');
  });

  it('reutiliza el formulario para registrar una salida desde la barra de acciones', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect((fixture.nativeElement as HTMLElement).querySelector('.cash-actions')?.textContent)
      .toContain('Registrar entrada');
    expect((fixture.nativeElement as HTMLElement).querySelector('.cash-actions')?.textContent)
      .toContain('Registrar salida');
    const boton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Registrar salida'))!;
    boton.click();
    component.conceptoMovimiento.set('Gasto de transporte');
    component.montoMovimiento.set('25.00');
    component.confirmarMovimiento(new Event('submit'));

    expect(cajaService.registrarMovimiento).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'Egreso', id_categoria: 3, monto: 25 }));
    expect(component.modalMovimientoAbierto()).toBe(false);
    expect(cajaService.obtenerSesionActual).toHaveBeenCalledTimes(2);
  });

  it('no muestra caja abierta si no existe sesión', () => {
    cajaService.obtenerSesionActual.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.header-status')).toBeNull();
  });

  it('presenta resumen, entregas y arqueo con diferencia automática', () => {
    cajaService.listarEntregas.mockReturnValue(of([entregaConfirmada]));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.seleccionarPestana('Cierre');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.close-cash-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.cash-closing-card')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.movement-summary-card')?.textContent).toContain('Total de ingresos');
    expect(fixture.nativeElement.querySelector('.movement-summary-card')?.textContent).toContain('Saldo esperado en caja');
    expect(fixture.nativeElement.querySelector('.collector-deliveries-card')?.textContent).toContain('Cobrador Real');
    expect(component.totalRecibidoCobradores()).toBe(100);
    expect(component.efectivoEsperado()).toBe(375.5);
    expect(component.diferenciaCierre()).toBeNull();

    component.efectivoContado.set('375.50');
    fixture.detectChanges();
    expect(component.diferenciaCierre()).toBe(0);
    expect(fixture.nativeElement.querySelector('.closing-difference.balanced')).not.toBeNull();
    component.efectivoContado.set('370.00');
    fixture.detectChanges();
    expect(component.diferenciaCierre()).toBe(-5.5);
    expect(fixture.nativeElement.querySelector('.closing-difference.unbalanced')?.textContent).toContain('Faltante');
    component.efectivoContado.set('380.00');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.closing-difference.unbalanced')?.textContent).toContain('Sobrante');
  });

  it('permite revisar una caja sin cobros y conserva habilitado el cierre válido', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.seleccionarPestana('Cierre');
    component.abrirModalCierre();
    fixture.detectChanges();

    expect(conciliacionBase.cobros).toEqual([]);
    expect(component.puedeCerrarCaja()).toBe(true);
    expect(fixture.nativeElement.querySelector('.cash-closing-status.ready')?.textContent).toContain('Caja lista para cerrar');
    component.efectivoContado.set('375.50');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.cash-closing-modal button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('oculta y bloquea el cierre para otro empleado o sin permiso de Caja', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.seleccionarPestana('Cierre');
    const original = usuarioAutenticado()!;
    for (const usuario of [
      { ...original, empleado: { ...original.empleado!, id_empleado: 8 } },
      { ...original, modulos: [] },
      { ...original, rol: { id: 2, nombre: 'Empleado' } },
    ]) {
      usuarioAutenticado.set(usuario);
      fixture.detectChanges();
      expect((fixture.nativeElement.querySelector('.close-cash-button') as HTMLButtonElement).disabled).toBe(true);
      component.abrirModalCierre();
      expect(component.modalCierreAbierto()).toBe(false);
    }
    expect(cajaService.cerrar).not.toHaveBeenCalled();
  });

  it('valida efectivo obligatorio y permite cancelar antes de enviar el cierre', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirModalCierre();
    for (const contado of ['', '-1', '1.001', '100000000.00']) {
      component.efectivoContado.set(contado);
      component.confirmarCierre(new Event('submit'));
    }
    expect(component.confirmacionCierreAbierta()).toBe(false);
    component.efectivoContado.set('0');
    expect(component.efectivoContadoValido()).toBe(true);
    component.confirmarCierre(new Event('submit'));
    expect(component.confirmacionCierreAbierta()).toBe(true);
    expect(cajaService.cerrar).not.toHaveBeenCalled();
    component.cancelarConfirmacionCierre();
    expect(component.confirmacionCierreAbierta()).toBe(false);
    component.cerrarModalCierre();
    expect(component.modalCierreAbierto()).toBe(false);
  });

  it('confirma una sola vez y conserva el historial de la sesión cerrada sin permitir movimientos', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const respuesta = new Subject<CierreCajaResponse>();
    cajaService.cerrar.mockReturnValue(respuesta);
    component.abrirModalCierre();
    component.efectivoContado.set('375.50');
    component.observacionesCierre.set(' Conteo revisado ');
    component.confirmarCierre(new Event('submit'));
    expect(component.confirmacionCierreAbierta()).toBe(true);
    component.confirmarCierreDefinitivo();
    component.confirmarCierreDefinitivo();
    component.cerrarModalCierre();
    expect(component.modalCierreAbierto()).toBe(true);
    expect(cajaService.cerrar).toHaveBeenCalledOnce();
    expect(cajaService.cerrar).toHaveBeenCalledWith(12, { monto_contado: 375.5, monto_sistema: 375.5, observaciones: 'Conteo revisado' });
    respuesta.next(cierre);
    respuesta.complete();
    fixture.detectChanges();

    expect(component.sesion()?.estado).toBe('Cerrada');
    expect(component.puedeCerrarCaja()).toBe(false);
    expect(component.modalCierreAbierto()).toBe(false);
    expect(component.movimientos()).toEqual([movimiento]);
    expect(component.puedeRegistrarMovimiento()).toBe(false);
    component.abrirModalMovimiento('Ingreso');
    expect(component.modalMovimientoAbierto()).toBe(false);
    expect(cajaService.registrarMovimiento).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('CAJA CERRADA');
    expect(fixture.nativeElement.textContent).toContain('Cierre de cobros por empleado');
    expect(component.puedeEntregar()).toBe(false);
  });

  it('mantiene el formulario y actualiza el resumen cuando FastAPI detecta un cambio concurrente', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.abrirModalCierre();
    component.efectivoContado.set('375.50');
    cajaService.cerrar.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { detail: 'El efectivo cambio' } })));
    cajaService.listarMovimientos.mockReturnValue(of({ items: [{ ...movimiento, monto: '130.00' }], total: 1, page: 1, page_size: 25, total_pages: 1 }));
    cajaService.conciliacion.mockReturnValue(of({ ...conciliacionBase, efectivo_esperado: '380.00' }));
    component.confirmarCierre(new Event('submit'));
    expect(component.confirmacionCierreAbierta()).toBe(true);
    component.confirmarCierreDefinitivo();
    expect(component.modalCierreAbierto()).toBe(true);
    expect(component.sesion()?.estado).toBe('Abierta');
    expect(component.errorCierre()).toContain('El efectivo cambio');
    expect(component.efectivoEsperado()).toBe(380);
    expect(component.diferenciaCierre()).toBe(-4.5);
    expect(component.cerrandoCaja()).toBe(false);
  });
});
