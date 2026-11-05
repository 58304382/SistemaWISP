import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../../auth/services/auth.service';
import { Cliente } from '../../../clientes/models/cliente.models';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { CobroSaldo, PagoConfirmado, ServicioInternetCobro } from '../../models/cobros.models';
import { CobrosService } from '../../services/cobros.service';
import { CobrosComponent } from './cobros.component';

describe('CobrosComponent', () => {
  let fixture: ComponentFixture<CobrosComponent>;
  let component: CobrosComponent;
  let service: {
    listarTodos: ReturnType<typeof vi.fn>;
    listarMetodosPago: ReturnType<typeof vi.fn>;
    listarTodosAnticipos: ReturnType<typeof vi.fn>;
    registrarPago: ReturnType<typeof vi.fn>;
    registrarPendiente: ReturnType<typeof vi.fn>;
    distribuirPago: ReturnType<typeof vi.fn>;
    listarComprobantes: ReturnType<typeof vi.fn>;
    descargarComprobantePdf: ReturnType<typeof vi.fn>;
    descargarComprobantePdfTermico: ReturnType<typeof vi.fn>;
    consultarComprobante: ReturnType<typeof vi.fn>;
    listarClientesActivos: ReturnType<typeof vi.fn>;
    listarCotizacionesOrden: ReturnType<typeof vi.fn>;
    listarCotizacionesInstalacion: ReturnType<typeof vi.fn>;
    listarServiciosInternet: ReturnType<typeof vi.fn>;
    listarEmpleadosReceptores: ReturnType<typeof vi.fn>;
    actualizarDiaVencimiento: ReturnType<typeof vi.fn>;
    generarMensualidadesInternet: ReturnType<typeof vi.fn>;
  };
  let clientesService: { getAll: ReturnType<typeof vi.fn> };
  let authService: {
    hasModule: ReturnType<typeof vi.fn>;
    isAdministrator: ReturnType<typeof vi.fn>;
    currentUser: ReturnType<typeof vi.fn>;
  };

  const clientes: Cliente[] = [
    {
      id_cliente: 4,
      id_municipio: 1,
      nombres: 'Ana',
      apellidos: 'Morales',
      dpi: null,
      telefono: '5555-0314',
      correo: null,
      direccion: 'Zona 1',
      referencia: null,
      estado: 'Activo',
      municipio: {
        id_municipio: 1,
        id_departamento: 1,
        nombre: 'Guatemala',
        codigo_postal: null,
        estado: 'Activo',
      },
    },
    {
      id_cliente: 5,
      id_municipio: 1,
      nombres: 'Luis',
      apellidos: 'Pérez',
      dpi: null,
      telefono: '5555-0101',
      correo: null,
      direccion: 'Zona 2',
      referencia: null,
      estado: 'Activo',
      municipio: {
        id_municipio: 1,
        id_departamento: 1,
        nombre: 'Guatemala',
        codigo_postal: null,
        estado: 'Activo',
      },
    },
  ];

  const cobros: CobroSaldo[] = [
    {
      id_cobro: 8,
      id_cliente: 4,
      origen_financiero: 'INSTALACIONES',
      id_instalacion: 12,
      id_servicio: null,
      periodo: null,
      fecha_emision: '2026-10-18',
      fecha_vencimiento: null,
      monto: '225.00',
      estado: 'Pendiente',
      cliente_nombre: 'Ana Morales',
      cliente_telefono: '5555-0314',
      numero_cotizacion: 'COT-2026-0010',
      id_proforma: 5,
      tipo_instalacion: 'Internet',
      id_orden_trabajo: null,
      codigo_orden: null,
      total_pagado: '25.00',
      saldo_pendiente: '200.00',
    },
    {
      id_cobro: 9,
      id_cliente: 4,
      origen_financiero: 'INSTALACIONES',
      id_instalacion: 13,
      id_servicio: null,
      periodo: null,
      fecha_emision: '2026-10-19',
      fecha_vencimiento: null,
      monto: '100.00',
      estado: 'Pendiente',
      cliente_nombre: 'Ana Morales',
      cliente_telefono: '5555-0314',
      numero_cotizacion: 'COT-2026-0011',
      id_proforma: 6,
      tipo_instalacion: 'Cámaras',
      id_orden_trabajo: null,
      codigo_orden: null,
      total_pagado: '0.00',
      saldo_pendiente: '100.00',
    },
  ];

  const servicioInternet: ServicioInternetCobro = {
    id_asignacion: 8,
    id_cliente: 4,
    id_plan: 2,
    costo_mensual: '225.00',
    fecha_inicio: '2026-10-25',
    dia_vencimiento: null,
    estado: 'Activo',
    fecha_creacion: '2026-10-25T10:00:00',
    fecha_actualizacion: null,
    cliente: {
      id_cliente: 4,
      nombres: 'Ana',
      apellidos: 'Morales',
      estado: 'Activo',
    },
    plan: {
      id: 2,
      nombre: 'Plan 20 Mbps',
      velocidad: '20 Mbps',
      precio_mensual: '225.00',
      estado: 'Activo',
    },
  };

  const cotizacionInstalacion = {
    id_cotizacion: 10,
    numero_cotizacion: 'COT-2026-0010',
    id_instalacion: 12,
    estado_instalacion: 'Completada',
    id_cliente: 4,
    cliente_nombre: 'Ana Morales',
    id_proforma: 5,
    monto: '225.00',
    total_pagado: '25.00',
    saldo_pendiente: '200.00',
    id_cobro: 8,
    estado_cotizacion: 'ACEPTADA',
  };

  const pago: PagoConfirmado = {
    id_pago: 31,
    id_cliente: 4,
    origen_financiero: 'INSTALACIONES',
    id_movimiento_caja: 21,
    clave_idempotencia: '6f51984f-e46b-4428-94a6-41ff3db37852',
    id_metodo_pago: 1,
    id_empleado: 7,
    id_entrega: null,
    monto_total: '250.00',
    tipo_pago: null,
    fecha_hora: '2026-10-18T15:00:00',
    referencia: null,
    observaciones: null,
    detalles: [
      {
        id_pago: 31,
        id_cobro: 8,
        id_cliente: 4,
        origen_financiero: 'INSTALACIONES',
        concepto: 'Cotización COT-2026-0010',
        monto_aplicado: '200.00',
      },
      {
        id_pago: 31,
        id_cobro: 9,
        id_cliente: 4,
        origen_financiero: 'INSTALACIONES',
        concepto: 'Cotización COT-2026-0011',
        monto_aplicado: '50.00',
      },
    ],
    monto_aplicado: '250.00',
    monto_no_aplicado: '0.00',
    comprobante: {
      id_comprobante: 41,
      id_pago: 31,
      numero: 'COB-000001',
      fecha_emision: '2026-10-18',
      fecha_hora: '2026-10-18T15:00:00',
      archivo_pdf: 'uploads/comprobantes_cobro/COB-000001.pdf',
      id_cliente: 4,
      cliente_nombre: 'Ana Morales',
      cliente_telefono: '5555-0314',
      origen_financiero: 'INSTALACIONES',
      servicio: 'Internet',
      periodo: null,
      metodo_pago: 'Efectivo',
      responsable: 'Ana Admin',
      subtotal: '250.00',
      descuento: '0.00',
      total: '250.00',
      saldo_a_favor: '0.00',
      agradecimiento: '¡Gracias por su preferencia!',
      conceptos: [
        { descripcion: 'Internet · Instalación #12', periodo: null, monto: '200.00' },
        { descripcion: 'Cámaras · Instalación #13', periodo: null, monto: '50.00' },
      ],
    },
  };

  beforeEach(async () => {
    service = {
      listarTodos: vi.fn().mockReturnValue(of(cobros)),
      listarMetodosPago: vi.fn().mockReturnValue(
        of([
          { id_metodo_pago: 1, nombre: 'Efectivo', descripcion: null, estado: 'Activo' },
          { id_metodo_pago: 2, nombre: 'Transferencia', descripcion: null, estado: 'Activo' },
        ]),
      ),
      listarTodosAnticipos: vi.fn().mockReturnValue(of([])),
      registrarPago: vi.fn().mockReturnValue(of(pago)),
      registrarPendiente: vi.fn().mockReturnValue(of(cobros[0])),
      distribuirPago: vi.fn().mockReturnValue(of(pago)),
      listarComprobantes: vi.fn().mockReturnValue(
        of({
          items: [
            {
              id_comprobante: 41,
              id_pago: 31,
              numero: 'COB-000001',
              fecha_emision: '2026-10-18',
              fecha_hora: '2026-10-18T15:00:00',
              archivo_pdf: 'uploads/comprobantes_cobro/COB-000001.pdf',
              id_cliente: 4,
              origen_financiero: 'INSTALACIONES',
              cliente_nombre: 'Ana Morales',
              metodo_pago: 'Efectivo',
              total: '250.00',
              responsable: 'Ana Admin',
            },
          ],
          total: 1,
          page: 1,
          page_size: 50,
          total_pages: 1,
        }),
      ),
      descargarComprobantePdf: vi.fn().mockReturnValue(of(new Blob(['%PDF-1.4']))),
      descargarComprobantePdfTermico: vi.fn().mockReturnValue(of(new Blob(['%PDF-1.4']))),
      consultarComprobante: vi
        .fn()
        .mockReturnValue(of({ ...pago.comprobante!, origen_financiero: 'INTERNET' })),
      listarClientesActivos: vi.fn().mockReturnValue(of(clientes)),
      listarCotizacionesOrden: vi.fn().mockReturnValue(of([])),
      listarCotizacionesInstalacion: vi.fn().mockReturnValue(of([cotizacionInstalacion])),
      listarServiciosInternet: vi.fn().mockReturnValue(of([servicioInternet])),
      listarEmpleadosReceptores: vi
        .fn()
        .mockReturnValue(
          of([{ id_empleado: 7, codigo: 'COB-007', nombres: 'Cobrador', apellidos: 'Real' }]),
        ),
      actualizarDiaVencimiento: vi
        .fn()
        .mockReturnValue(of({ ...servicioInternet, dia_vencimiento: 15 })),
      generarMensualidadesInternet: vi
        .fn()
        .mockReturnValue(
          of({ periodo: '2026-10', generadas: 1, existentes: 0, total_elegibles: 1 }),
        ),
    };
    clientesService = { getAll: vi.fn().mockReturnValue(of(clientes)) };
    authService = {
      hasModule: vi.fn().mockReturnValue(true),
      isAdministrator: vi.fn().mockReturnValue(true),
      currentUser: vi.fn().mockReturnValue({ empleado: { id_empleado: 7 } }),
    };
    await TestBed.configureTestingModule({
      imports: [CobrosComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: authService,
        },
        { provide: CobrosService, useValue: service },
        { provide: ClientesService, useValue: clientesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CobrosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // La custodia de Internet se asigna automáticamente desde el empleado del
    // usuario autenticado; no requiere selector ni lista de receptores.
  });

  afterEach(() => vi.useRealTimers());

  it('registra efectivo de Internet como recibido por el empleado autenticado', () => {
    const mensualidad = { ...component.cobros()[0], categoria: 'INTERNET' as const };
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    // La custodia es automática; no se consulta la lista de receptores.
    expect(service.listarEmpleadosReceptores).not.toHaveBeenCalled();
    expect(component.pagoVisualValido()).toBe(true);
    component.abrirComprobante();
    const payload = service.registrarPago.mock.calls[0][0];
    expect(payload).toMatchObject({ recepcion_efectivo: 'EMPLEADO', id_empleado_receptor: 7 });
    expect(payload).not.toHaveProperty('id_usuario_registro');
  });

  it('omite custodia física en pagos no efectivos y usa EMPLEADO en efectivo', () => {
    const mensualidad = { ...component.cobros()[0], categoria: 'INTERNET' as const };
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    // Efectivo de Internet: custodia automática del empleado autenticado.
    expect(component.pagoVisualValido()).toBe(true);
    component.abrirComprobante();
    expect(service.registrarPago.mock.calls[0][0]).toMatchObject({
      recepcion_efectivo: 'EMPLEADO',
      id_empleado_receptor: 7,
    });
    // Transferencia: no requiere recepción física.
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    component.metodoPago.set(2);
    component.referenciaPago.set('TRX-1');
    component.abrirComprobante();
    expect(service.registrarPago.mock.calls[1][0]).not.toHaveProperty('recepcion_efectivo');
  });

  it('limita la custodia física a Internet y conserva el pago de proyectos', () => {
    const instalacion = { ...component.cobros()[0], categoria: 'INSTALACIONES' as const };
    component.cobros.set([instalacion]);
    service.listarEmpleadosReceptores.mockClear();

    component.abrirRegistroCobro(instalacion);

    expect(component.requiereRecepcionFisica()).toBe(false);
    expect(service.listarEmpleadosReceptores).not.toHaveBeenCalled();
    component.abrirComprobante();
    expect(service.registrarPago.mock.calls.at(-1)?.[0]).not.toHaveProperty('recepcion_efectivo');
  });

  it('carga y adapta cobros, clientes, documentos y métodos reales', () => {
    expect(service.listarTodos).toHaveBeenCalledOnce();
    expect(service.listarMetodosPago).toHaveBeenCalledOnce();
    expect(service.listarServiciosInternet).toHaveBeenCalledOnce();
    expect(clientesService.getAll).toHaveBeenCalledOnce();
    expect(component.clientesVisuales().map((cliente) => cliente.nombre)).toEqual([
      'Ana Morales',
      'Luis Pérez',
    ]);
    expect(component.cobros()[0]).toMatchObject({
      cliente: 'Ana Morales',
      codigo: '#12',
      comprobante: 'COT-2026-0010',
      proforma: '#5',
      saldoPendiente: 200,
    });
    component.seleccionarCategoria('INSTALACIONES');
    expect(component.resumen().find((item) => item.estado === 'PENDIENTE')?.total).toBe(300);
  });

  it('muestra y configura el vencimiento individual sin registrar pagos', () => {
    expect(fixture.nativeElement.textContent).not.toContain('Sin configurar');
    component.abrirModalVencimientos();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sin configurar');
    expect(fixture.nativeElement.textContent).toContain('Plan 20 Mbps');

    component.iniciarEdicionDiaVencimiento(servicioInternet);
    const input = document.createElement('input');
    input.value = '15';
    component.actualizarDiaVencimientoEdicion({ target: input } as unknown as Event);
    component.guardarDiaVencimiento();

    expect(service.actualizarDiaVencimiento).toHaveBeenCalledWith(8, {
      dia_vencimiento: 15,
    });
    expect(component.serviciosInternet()[0].dia_vencimiento).toBe(15);
    expect(component.serviciosInternet()[0].costo_mensual).toBe('225.00');
    expect(service.registrarPago).not.toHaveBeenCalled();
    expect(service.registrarPendiente).not.toHaveBeenCalled();
  });

  it('separa la administración de vencimientos del registro y la generación', () => {
    authService.isAdministrator.mockReturnValue(false);
    authService.hasModule.mockImplementation(
      (codigo: string) => codigo === 'administrar_vencimientos_internet',
    );
    service.listarTodos.mockClear();
    service.listarMetodosPago.mockClear();
    clientesService.getAll.mockClear();

    const fixtureLimitado = TestBed.createComponent(CobrosComponent);
    fixtureLimitado.detectChanges();
    fixtureLimitado.componentInstance.abrirModalVencimientos();
    fixtureLimitado.detectChanges();
    const contenido = fixtureLimitado.nativeElement.textContent;

    expect(contenido).toContain('Generar mensualidades');
    expect(contenido).toContain('Configurar');
    expect(contenido).not.toContain('Guardar y generar mensualidades');
    expect(contenido).not.toContain('Registrar pago');
    expect(service.listarServiciosInternet).toHaveBeenCalled();
    expect(service.listarTodos).not.toHaveBeenCalled();
    expect(clientesService.getAll).not.toHaveBeenCalled();
  });

  it('permite generar sin habilitar la edición de vencimientos', () => {
    authService.isAdministrator.mockReturnValue(false);
    authService.hasModule.mockImplementation(
      (codigo: string) => codigo === 'generar_mensualidades_internet',
    );

    const fixtureLimitado = TestBed.createComponent(CobrosComponent);
    fixtureLimitado.detectChanges();
    fixtureLimitado.componentInstance.abrirModalVencimientos();
    fixtureLimitado.detectChanges();
    const contenido = fixtureLimitado.nativeElement.textContent;

    expect(contenido).toContain('Mes y año');
    expect(contenido).toContain('Guardar y generar mensualidades');
    expect(contenido).not.toContain('Configurar');
  });

  it('rechaza días vacíos, decimales o fuera del rango 1 a 31', () => {
    component.iniciarEdicionDiaVencimiento(servicioInternet);

    for (const valor of ['', '0', '1.5', '32']) {
      const input = document.createElement('input');
      input.value = valor;
      component.actualizarDiaVencimientoEdicion({ target: input } as unknown as Event);
      component.guardarDiaVencimiento();
    }

    expect(service.actualizarDiaVencimiento).not.toHaveBeenCalled();
    expect(component.errorDiaVencimiento()).toContain('entre 1 y 31');
  });

  it('genera mensualidades, muestra el resumen y lista solo cobros de Internet', () => {
    const mensualidad: CobroSaldo = {
      ...cobros[0],
      id_cobro: 40,
      origen_financiero: 'INTERNET',
      id_instalacion: null,
      id_servicio: 8,
      periodo: '2026-10',
      fecha_emision: '2026-10-01',
      fecha_vencimiento: '2026-10-31',
      monto: '225.00',
      numero_cotizacion: null,
      id_proforma: null,
      tipo_instalacion: null,
      total_pagado: '25.00',
      saldo_pendiente: '200.00',
    };
    service.listarTodos.mockReturnValueOnce(of([mensualidad, ...cobros]));
    component.periodoGeneracion.set('2026-10');

    component.guardarYGenerarMensualidades();
    fixture.detectChanges();

    expect(service.generarMensualidadesInternet).toHaveBeenCalledWith({ mes: 10, anio: 2026 });
    expect(component.mensajeGeneracion()).toContain('1 mensualidad generada');
    expect(component.filtroPeriodo()).toBe('2026-10');
    expect(component.cobrosFiltrados().every((cobro) => cobro.categoria === 'INTERNET')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Plan 20 Mbps');
    expect(fixture.nativeElement.textContent).toContain('200.00');
    expect(service.registrarPago).not.toHaveBeenCalled();
  });

  it('muestra el contador de mensualidades existentes al reintentar el período', () => {
    service.generarMensualidadesInternet.mockReturnValueOnce(
      of({ periodo: '2026-10', generadas: 0, existentes: 1, total_elegibles: 1 }),
    );
    service.listarTodos.mockReturnValueOnce(of(cobros));
    component.periodoGeneracion.set('2026-10');

    component.generarMensualidades();
    fixture.detectChanges();

    expect(component.mensajeGeneracion()).toBe(
      '0 mensualidades generadas y 1 ya existente, de 1 servicio elegible.',
    );
    expect(component.filtroPeriodo()).toBe('2026-10');
    expect(service.listarTodos).toHaveBeenCalledTimes(2);
    expect(service.registrarPago).not.toHaveBeenCalled();
  });

  it('mantiene bloqueada la generación hasta actualizar listado y contadores', () => {
    const recarga = new Subject<CobroSaldo[]>();
    service.listarTodos.mockReturnValueOnce(recarga);
    component.periodoGeneracion.set('2026-10');

    component.generarMensualidades();

    expect(component.generandoMensualidades()).toBe(true);
    component.generarMensualidades();
    expect(service.generarMensualidadesInternet).toHaveBeenCalledTimes(1);

    recarga.next(cobros);
    recarga.complete();
    fixture.detectChanges();

    expect(component.generandoMensualidades()).toBe(false);
    expect(component.mensajeGeneracion()).toContain('1 servicio elegible');
  });

  it('rechaza el año cero antes de solicitar la generación', () => {
    component.periodoGeneracion.set('0000-10');

    component.generarMensualidades();

    expect(service.generarMensualidadesInternet).not.toHaveBeenCalled();
    expect(component.errorGeneracion()).toContain('mes y año válidos');
  });

  it('no genera si falla el guardado previo del vencimiento', () => {
    service.actualizarDiaVencimiento.mockReturnValueOnce(
      throwError(() => new Error('fallo de actualización')),
    );
    component.iniciarEdicionDiaVencimiento(servicioInternet);
    component.diaVencimientoEdicion.set('15');

    component.guardarYGenerarMensualidades();

    expect(service.actualizarDiaVencimiento).toHaveBeenCalledWith(8, {
      dia_vencimiento: 15,
    });
    expect(service.generarMensualidadesInternet).not.toHaveBeenCalled();
    expect(component.errorDiaVencimiento()).toContain('No se generaron mensualidades');
  });

  it('informa el guardado parcial si después falla la generación', () => {
    service.generarMensualidadesInternet.mockReturnValueOnce(
      throwError(() => new Error('fallo de generación')),
    );
    component.iniciarEdicionDiaVencimiento(servicioInternet);
    component.diaVencimientoEdicion.set('15');

    component.guardarYGenerarMensualidades();

    expect(component.serviciosInternet()[0].dia_vencimiento).toBe(15);
    expect(component.mensajeGeneracion()).toContain('se guardó correctamente');
    expect(component.errorGeneracion()).toContain('mensualidades no se generaron');
  });

  it('registra una instalación pendiente con Q0.00 sin solicitar ni confirmar dinero', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    component.metodoPago.set(2);
    const selector = document.createElement('select');
    selector.add(new Option('Pago pendiente', 'PENDIENTE'));
    component.actualizarTipoPagoInstalacion({ target: selector } as unknown as Event);
    fixture.detectChanges();
    expect(component.montoPago()).toBe(0);
    expect(component.pagoVisualValido()).toBe(true);
    expect(fixture.nativeElement.querySelector('.payment-form input[type="number"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Registrar pendiente');
    component.abrirComprobante();

    const payload = service.registrarPendiente.mock.calls[0][0];
    expect(payload).toEqual({
      id_cliente: 4,
      origen_financiero: 'INSTALACIONES',
      monto_total: 0,
      tipo_pago: 'PENDIENTE',
      id_cotizacion: 10,
    });
    expect(service.registrarPago).not.toHaveBeenCalled();
    expect(service.distribuirPago).not.toHaveBeenCalled();
    expect(component.saldoRestante()).toBe(200);
    expect(component.pagoConfirmado()).toBeNull();
    expect(component.comprobanteAbierto()).toBe(false);
    expect(component.modalRegistroAbierto()).toBe(false);
  });

  it('permite un anticipo de instalación sin aplicaciones', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    component.seleccionarCliente(4);
    component.tipoPagoInstalacion.set('ANTICIPO');
    component.montoPago.set(75);
    component.abrirComprobante();

    expect(service.registrarPago.mock.calls[0][0]).toMatchObject({
      tipo_pago: 'ANTICIPO',
      id_cotizacion: 10,
      aplicaciones: [],
    });
  });

  it('mantiene Q0.00 al cambiar de cotización y permite volver al pago total', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    const selector = document.createElement('select');
    selector.add(new Option('Pago pendiente', 'PENDIENTE'));
    selector.add(new Option('Pago total', 'TOTAL'));
    selector.value = 'PENDIENTE';
    component.actualizarTipoPagoInstalacion({ target: selector } as unknown as Event);
    component.metodosPago.set([]);
    component.alternarCotizacionInstalacion(10);
    component.alternarCotizacionInstalacion(10);
    expect(component.montoPago()).toBe(0);
    expect(component.pagoVisualValido()).toBe(true);
    expect(component.saldoRestante()).toBe(200);
    selector.value = 'TOTAL';
    component.actualizarTipoPagoInstalacion({ target: selector } as unknown as Event);
    expect(component.registrandoPendiente()).toBe(false);
    expect(component.montoPago()).toBe(200);
  });

  it('mantiene el formulario pendiente si falla el registro sin simular un pago', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    const selector = document.createElement('select');
    selector.add(new Option('Pago pendiente', 'PENDIENTE'));
    component.actualizarTipoPagoInstalacion({ target: selector } as unknown as Event);
    service.registrarPendiente.mockReturnValue(throwError(() => new Error('Fallo simulado')));
    component.abrirComprobante();
    expect(component.modalRegistroAbierto()).toBe(true);
    expect(component.errorPago()).not.toBe('');
    expect(component.guardandoPago()).toBe(false);
    expect(component.pagoConfirmado()).toBeNull();
    expect(service.registrarPago).not.toHaveBeenCalled();
  });

  it('permite cobrar la cotización sin instalación programada', () => {
    service.listarCotizacionesInstalacion.mockReturnValueOnce(
      of([
        {
          ...cotizacionInstalacion,
          id_instalacion: null,
          estado_instalacion: null,
          total_pagado: '0.00',
          saldo_pendiente: '900.00',
          id_cobro: null,
        },
      ]),
    );
    component.abrirRegistroCobro(component.cobros()[0]);
    component.alternarCotizacionInstalacion(10);

    expect(component.cotizacionesInstalacion()[0].id_instalacion).toBeNull();
    expect(component.totalSeleccionado()).toBe(900);
    expect(component.pagoVisualValido()).toBe(true);
    component.abrirComprobante();
    expect(service.registrarPago).toHaveBeenCalledWith(
      expect.objectContaining({
        id_cotizacion: 10,
        origen_financiero: 'INSTALACIONES',
        monto_total: 900,
        tipo_pago: 'TOTAL',
      }),
    );
  });

  it('aplica un anticipo histórico de instalación sin registrar otro pago', () => {
    service.listarTodosAnticipos.mockReturnValueOnce(
      of([
        {
          id_pago: 31,
          id_cliente: 4,
          origen_financiero: 'INSTALACIONES',
          fecha_hora: '2026-10-17T10:00:00',
          id_metodo_pago: 1,
          metodo_pago: 'Efectivo',
          monto_total: '250.00',
          tipo_pago: null,
          monto_aplicado: '200.00',
          monto_no_aplicado: '50.00',
          referencia: null,
          observaciones: null,
        },
      ]),
    );
    component.abrirRegistroCobro(component.cobros()[0]);
    const selector = document.createElement('select');
    selector.add(new Option('Pago #31', '31'));
    selector.value = '31';
    component.actualizarAnticipo({ target: selector } as unknown as Event);
    component.abrirComprobante();

    expect(service.distribuirPago).toHaveBeenCalledWith(31, {
      aplicaciones: [
        expect.objectContaining({
          id_cobro: 8,
          concepto: 'Cotización COT-2026-0010',
          monto_aplicado: 50,
        }),
      ],
      id_cotizacion: 10,
    });
    expect(service.registrarPago).not.toHaveBeenCalled();
    expect(component.anticipoAplicado()).toBe(true);
  });

  it('exige referencia real para métodos no efectivos', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    component.metodoPago.set(2);

    expect(component.pagoVisualValido()).toBe(false);
    expect(component.mensajeValidacionPago()).toContain('referencia bancaria');

    component.referenciaPago.set('TRX-100');
    expect(component.pagoVisualValido()).toBe(true);
  });

  it('habilita y confirma una mensualidad de Internet con su origen independiente', () => {
    const mensualidad = {
      ...component.cobros()[0],
      categoria: 'INTERNET' as const,
      servicioId: 8,
      instalacionId: null,
      periodo: '2026-11',
      concepto: 'Plan 20 Mbps · 2026-11',
    };
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    component.metodoPago.set(1);
    fixture.detectChanges();

    const confirmar = [...fixture.nativeElement.querySelectorAll('button')].find(
      (boton: HTMLButtonElement) => boton.textContent?.includes('Confirmar pago'),
    ) as HTMLButtonElement;
    expect(component.pagoVisualValido()).toBe(true);
    expect(component.mensajeValidacionPago()).not.toContain('instalación');
    expect(confirmar.disabled).toBe(false);

    component.abrirComprobante();

    expect(service.registrarPago).toHaveBeenCalledWith(
      expect.objectContaining({
        origen_financiero: 'INTERNET',
        aplicaciones: [expect.objectContaining({ id_cobro: 8, monto_aplicado: 200 })],
      }),
    );
  });

  it('proyecta 12 meses facturables después del mes gratuito y cruza de año', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    component.serviciosInternet.set([
      { ...servicioInternet, fecha_inicio: '2026-12-20', dia_vencimiento: 31 },
    ]);
    component.abrirRegistroCobro();
    component.seleccionarCliente(4);
    component.seleccionarCategoriaRegistro('INTERNET');

    const periodos = component.periodosInternetProyectados();

    expect(periodos).toHaveLength(12);
    expect(periodos[0]).toMatchObject({
      id: 'periodo:8:2027-01',
      periodo: '2027-01',
      vencimiento: '2027-01-31',
      proyectado: true,
    });
    expect(periodos[1].vencimiento).toBe('2027-02-28');
    expect(periodos.at(-1)?.periodo).toBe('2027-12');
  });

  it('confirma Internet y abre el comprobante existente sin repetir el pago', () => {
    const respuesta = new Subject<PagoConfirmado>();
    service.registrarPago.mockReturnValueOnce(respuesta);
    const mensualidad = { ...component.cobros()[0], categoria: 'INTERNET' as const };
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    component.abrirComprobante();
    expect(component.confirmacionPagoAbierta()).toBe(false);

    const confirmado = { ...pago, origen_financiero: 'INTERNET' as const };
    respuesta.next(confirmado);
    respuesta.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Pago registrado exitosamente');
    expect(component.modalRegistroAbierto()).toBe(false);
    expect(component.comprobanteAbierto()).toBe(false);
    const generar = [...fixture.nativeElement.querySelectorAll('button')].find(
      (boton: HTMLButtonElement) => boton.textContent?.trim() === 'Generar comprobante',
    ) as HTMLButtonElement;
    generar.click();
    fixture.detectChanges();
    expect(component.comprobanteActual()).toBe(confirmado.comprobante);
    expect(component.comprobanteAbierto()).toBe(true);
    expect(service.registrarPago).toHaveBeenCalledTimes(1);
    expect(service.distribuirPago).not.toHaveBeenCalled();
    expect(service.generarMensualidadesInternet).not.toHaveBeenCalled();
  });

  it('imprime el ticket confirmado después de renderizarlo sin emitir otro pago', () => {
    vi.useFakeTimers();
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {});
    component.pagoConfirmado.set({ ...pago, origen_financiero: 'INTERNET' });
    component.confirmacionPagoAbierta.set(true);
    component.mostrarComprobanteRegistrado(true);
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    expect(imprimir).toHaveBeenCalledOnce();
    expect(document.querySelector('#thermal-ticket-page-size')?.textContent).toContain('58mm');
    expect(service.registrarPago).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    imprimir.mockRestore();
  });

  it('un error de pago Internet no muestra confirmación ni opciones de comprobante', () => {
    service.registrarPago.mockReturnValueOnce(throwError(() => new Error('fallo')));
    const mensualidad = { ...component.cobros()[0], categoria: 'INTERNET' as const };
    component.cobros.set([mensualidad]);
    component.abrirRegistroCobro(mensualidad);
    component.abrirComprobante();
    fixture.detectChanges();
    expect(component.confirmacionPagoAbierta()).toBe(false);
    expect(component.comprobanteAbierto()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Generar comprobante');
    expect(fixture.nativeElement.textContent).not.toContain('Pago registrado exitosamente');
  });

  it('consulta el historial de una mensualidad pagada usando su id_cobro', () => {
    const mensualidad = {
      ...component.cobros()[0],
      id: 70,
      servicioId: 8,
      categoria: 'INTERNET' as const,
      estadoCobro: 'PAGADO' as const,
      saldoPendiente: 0,
    };
    component.abrirHistorialComprobantes(mensualidad);
    fixture.detectChanges();
    expect(service.listarComprobantes).toHaveBeenCalledWith(70);
    expect(fixture.nativeElement.textContent).toContain('COB-000001');
    expect(fixture.nativeElement.textContent).toContain('Imprimir Ticket');
    expect(service.registrarPago).not.toHaveBeenCalled();
  });

  it('imprime desde el historial consultando solo el PDF ya emitido', () => {
    vi.useFakeTimers();
    const revocar = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue('blob:comprobante-existente'),
        revokeObjectURL: revocar,
      }),
    );
    try {
      component.abrirHistorialComprobantes(component.cobros()[0]);
      const comprobante = component.comprobantesHistorial()[0];
      component.imprimirComprobanteHistorial(comprobante);
      expect(service.descargarComprobantePdf).toHaveBeenCalledWith(41);
      const marco = document.querySelector('iframe')!;
      expect(marco.title).toBe(`Comprobante ${comprobante.numero}`);
      const imprimir = vi.fn();
      const escuchar = vi.fn();
      Object.defineProperty(marco, 'contentWindow', {
        configurable: true,
        value: { print: imprimir, addEventListener: escuchar },
      });
      marco.dispatchEvent(new Event('load'));
      expect(imprimir).toHaveBeenCalledOnce();
      expect(escuchar.mock.calls[0][0]).toBe('afterprint');
      escuchar.mock.calls[0][1]();
      expect(revocar).toHaveBeenCalledWith('blob:comprobante-existente');
      expect(service.registrarPago).not.toHaveBeenCalled();
      expect(service.distribuirPago).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('excluye la asignación y período persistidos y los clasifica como adelantados', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    const persistidoFuturo = {
      ...component.cobros()[0],
      id: 40,
      categoria: 'INTERNET' as const,
      servicioId: 8,
      periodo: '2026-11',
      vencimiento: '2026-11-30',
    };
    component.cobros.set([persistidoFuturo]);
    component.serviciosInternet.set([{ ...servicioInternet, dia_vencimiento: 30 }]);
    component.abrirRegistroCobro();
    component.seleccionarCliente(4);
    component.seleccionarCategoriaRegistro('INTERNET');

    expect(component.mensualidadesInternet()).toEqual([]);
    expect(component.periodosInternetProyectados().some((item) => item.periodo === '2026-11')).toBe(
      false,
    );
    expect(component.pagosAdelantadosInternet()[0]).toMatchObject({
      id: 40,
      periodo: '2026-11',
      proyectado: false,
    });
  });

  it('muestra el mes actual en Mensualidades y no como adelantado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    component.serviciosInternet.set([
      { ...servicioInternet, fecha_inicio: '2026-01-15', dia_vencimiento: 15 },
    ]);
    component.abrirRegistroCobro();
    component.seleccionarCliente(4);
    component.seleccionarCategoriaRegistro('INTERNET');

    expect(component.mensualidadesInternet()).toEqual([
      expect.objectContaining({ periodo: '2026-10', proyectado: true, adelantado: false }),
    ]);
    expect(component.pagosAdelantadosInternet().some((item) => item.periodo === '2026-10')).toBe(
      false,
    );
  });

  it('envía selección mixta sin IDs ficticios y exige su pago completo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    const persistidoActual = {
      ...component.cobros()[0],
      id: 40,
      categoria: 'INTERNET' as const,
      servicioId: 8,
      periodo: '2026-10',
      vencimiento: '2026-10-31',
    };
    component.cobros.set([persistidoActual]);
    component.serviciosInternet.set([{ ...servicioInternet, dia_vencimiento: 31 }]);
    component.abrirRegistroCobro(component.cobros()[0]);
    component.alternarObligacion('periodo:8:2026-11');
    component.montoPago.set(424);

    expect(component.totalSeleccionado()).toBe(425);
    expect(component.pagoVisualValido()).toBe(false);
    expect(component.mensajeValidacionPago()).toContain('pago completo');

    component.montoPago.set(425);
    component.abrirComprobante();

    const payload = service.registrarPago.mock.calls.at(-1)?.[0];
    expect(payload.aplicaciones).toEqual([
      expect.objectContaining({ id_cobro: 40, monto_aplicado: 200 }),
    ]);
    expect(payload.periodos_internet).toEqual([{ id_servicio: 8, periodo: '2026-11' }]);
    expect(
      payload.aplicaciones.every(
        (item: { id_cobro: unknown }) => typeof item.id_cobro === 'number',
      ),
    ).toBe(true);
    expect(service.generarMensualidadesInternet).not.toHaveBeenCalled();
  });

  it('permite proyectar y pagar con pagos_internet sin permiso administrativo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29));
    authService.isAdministrator.mockReturnValue(false);
    authService.hasModule.mockImplementation((codigo: string) => codigo === 'pagos_internet');
    service.listarServiciosInternet.mockReturnValueOnce(
      of([{ ...servicioInternet, dia_vencimiento: 15 }]),
    );

    const fixturePagos = TestBed.createComponent(CobrosComponent);
    fixturePagos.detectChanges();
    const cobrosPagos = fixturePagos.componentInstance;
    cobrosPagos.abrirRegistroCobro();
    cobrosPagos.seleccionarCliente(4);
    cobrosPagos.alternarObligacion('periodo:8:2026-11');
    cobrosPagos.abrirComprobante();

    expect(cobrosPagos.periodosInternetProyectados()).toHaveLength(12);
    expect(service.registrarPago).toHaveBeenCalledWith(
      expect.objectContaining({
        aplicaciones: [],
        periodos_internet: [{ id_servicio: 8, periodo: '2026-11' }],
      }),
    );
    expect(service.generarMensualidadesInternet).not.toHaveBeenCalled();
    fixturePagos.destroy();
  });

  it('registra la obligación de orden sin dinero usando el estado comercial del servidor', () => {
    service.listarCotizacionesOrden.mockReturnValueOnce(
      of([
        {
          id_cotizacion: 20,
          numero_cotizacion: 'COT-2026-0020',
          id_orden: 8,
          codigo_orden: 'OT-2026-0008',
          estado_orden: 'En Proceso',
          id_cliente: 4,
          cliente_nombre: 'Ana Morales',
          id_proforma: 9,
          monto: '300.00',
          total_pagado: '0.00',
          saldo_pendiente: '300.00',
          id_cobro: null,
          estado_cotizacion: 'ACEPTADA',
        },
      ]),
    );
    component.abrirRegistroCobro(component.cobros()[0]);
    component.seleccionarCategoriaRegistro('ORDENES_TRABAJO');
    const selector = document.createElement('select');
    selector.add(new Option('Pago pendiente', 'PENDIENTE'));
    component.actualizarTipoPagoOrden({ target: selector } as unknown as Event);
    component.abrirComprobante();

    const payload = service.registrarPendiente.mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({
      origen_financiero: 'ORDENES_TRABAJO',
      id_cotizacion: 20,
      monto_total: 0,
      tipo_pago: 'PENDIENTE',
    });
    expect(service.registrarPago).not.toHaveBeenCalled();
    expect(service.distribuirPago).not.toHaveBeenCalled();
    expect(component.saldoRestante()).toBe(300);
    expect(component.comprobanteAbierto()).toBe(false);
    expect(component.modalRegistroAbierto()).toBe(false);
  });

  it('valida el monto de cada tipo de pago de orden', () => {
    service.listarCotizacionesOrden.mockReturnValueOnce(
      of([
        {
          id_cotizacion: 20,
          numero_cotizacion: 'COT-2026-0020',
          id_orden: 8,
          codigo_orden: 'OT-2026-0008',
          estado_orden: 'Completada',
          id_cliente: 4,
          cliente_nombre: 'Ana Morales',
          id_proforma: 9,
          monto: '300.00',
          total_pagado: '100.00',
          saldo_pendiente: '200.00',
          id_cobro: 50,
          estado_cotizacion: 'COMPLETADA',
        },
      ]),
    );
    component.abrirRegistroCobro(component.cobros()[0]);
    component.seleccionarCategoriaRegistro('ORDENES_TRABAJO');

    component.tipoPagoOrden.set('TOTAL');
    component.montoPago.set(100);
    expect(component.mensajeValidacionPago()).toContain('exactamente');

    for (const tipo of ['ANTICIPO'] as const) {
      component.tipoPagoOrden.set(tipo);
      component.montoPago.set(200);
      expect(component.mensajeValidacionPago()).toContain('menor que el saldo');
      component.montoPago.set(100);
      expect(component.pagoVisualValido()).toBe(true);
    }
  });

  it('valida el monto de cada tipo de pago de instalación', () => {
    component.abrirRegistroCobro(component.cobros()[0]);

    component.tipoPagoInstalacion.set('TOTAL');
    component.montoPago.set(100);
    expect(component.mensajeValidacionPago()).toContain('exactamente');

    for (const tipo of ['ANTICIPO'] as const) {
      component.tipoPagoInstalacion.set(tipo);
      component.montoPago.set(200);
      expect(component.mensajeValidacionPago()).toContain('menor que el saldo');
      component.montoPago.set(100);
      expect(component.pagoVisualValido()).toBe(true);
    }
  });

  it('cierra el registro de instalación sin abrir comprobante PDF', () => {
    component.abrirRegistroCobro(component.cobros()[0]);
    component.montoPago.set(200);
    component.abrirComprobante();
    fixture.detectChanges();

    expect(component.pagoConfirmado()?.id_movimiento_caja).toBe(21);
    expect(component.comprobanteAbierto()).toBe(false);
    expect(component.modalRegistroAbierto()).toBe(false);
    expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
  });

  it('oculta comprobantes para Instalaciones y los conserva para Internet', () => {
    component.seleccionarCategoria('INSTALACIONES');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Comprobantes');
    expect(service.listarComprobantes).not.toHaveBeenCalled();

    component.cobros.set([{ ...component.cobros()[0], categoria: 'INTERNET' }]);
    component.seleccionarCategoria('INTERNET');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Comprobantes');
  });

  it('muestra el ticket térmico con todos los períodos y oculta descuento cero', () => {
    const comprobante = {
      ...pago.comprobante!,
      empresa_nombre: 'Empresa Configurada',
      empresa_descripcion: 'Servicios de Internet',
      empresa_direccion: 'Zona 1',
      empresa_telefono: '2222-2222',
      empresa_logo_url: '/uploads/documentos_comerciales/logo.png',
      servicio: 'Plan Hogar · 20 Mbps',
      periodos: ['2026-11', '2026-12'],
      proxima_fecha_pago: '2027-01-15',
      descuento: '0.00',
      agradecimiento: 'Mensaje configurable',
      nota_fiscal: 'Nota fiscal configurable',
      conceptos: [
        { descripcion: 'Internet 2026-12', periodo: '2026-12', monto: '225.50' },
        { descripcion: 'Internet 2026-11', periodo: '2026-11', monto: '225.50' },
      ],
    };
    component.pagoConfirmado.set({ ...pago, comprobante });
    component.comprobanteAbierto.set(true);
    fixture.detectChanges();

    const contenido = fixture.nativeElement.textContent;
    expect(contenido).toContain('Empresa Configurada');
    expect(contenido).toContain('noviembre de 2026');
    expect(contenido).toContain('diciembre de 2026');
    expect(contenido.indexOf('noviembre de 2026')).toBeLessThan(
      contenido.indexOf('diciembre de 2026'),
    );
    const ticket = fixture.nativeElement.querySelector('.thermal-ticket');
    expect(ticket.textContent).not.toContain('2026-11');
    expect(ticket.textContent).not.toContain('Responsable');
    expect(ticket.textContent).not.toContain('Empleado');
    expect(ticket.textContent).not.toContain(comprobante.responsable);
    expect(ticket.textContent).toContain('Plan Hogar · 20 Mbps');
    expect(ticket.querySelector('.thermal-logo')).toBeNull();
    expect(component.nombrePeriodoComprobante('Internet 2026-11')).toBe(
      'Internet noviembre de 2026',
    );
    expect(contenido).toContain('Próxima fecha de pago');
    expect(contenido).toContain('Mensaje configurable');
    expect(contenido).toContain('Nota fiscal configurable');
    expect(contenido).not.toContain('Descuento');
  });

  it('omite la nota fiscal y su espacio cuando está vacía', () => {
    const comprobante = {
      ...pago.comprobante!,
      nota_fiscal: '',
    };
    component.pagoConfirmado.set({ ...pago, comprobante });
    component.comprobanteAbierto.set(true);
    fixture.detectChanges();

    const ticket = fixture.nativeElement.querySelector('.thermal-ticket');
    expect(ticket.querySelector('.thermal-legal')).toBeNull();
    expect(ticket.textContent).not.toContain('No constituye comprobante fiscal.');
  });

  it('muestra el descuento solo cuando es mayor que cero', () => {
    const comprobante = {
      ...pago.comprobante!,
      descuento: '25.00',
    };
    component.pagoConfirmado.set({ ...pago, comprobante });
    component.comprobanteAbierto.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Descuento');
  });

  it('abre Documento Comprobante desde cada mensualidad y vuelve conservando filtros', () => {
    for (const id of [70, 71]) {
      const cobro = {
        ...component.cobros()[0],
        id,
        categoria: 'INTERNET' as const,
        tieneComprobante: true,
      };
      component.cobros.set([cobro]);
      component.seleccionarCategoria('INTERNET');
      fixture.detectChanges();
      const ver = [...fixture.nativeElement.querySelectorAll('button')].find(
        (boton: HTMLButtonElement) => boton.textContent?.includes('Ver comprobante'),
      ) as HTMLButtonElement;
      ver.click();
      fixture.detectChanges();
      expect(service.listarComprobantes).toHaveBeenLastCalledWith(id);
      expect(service.consultarComprobante).toHaveBeenLastCalledWith(41);
      expect(component.comprobanteOriginal()?.id_comprobante).toBe(41);
      expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('.collections-page')).toBeNull();
      expect(
        fixture.nativeElement.querySelector('.receipt-document-page .thermal-ticket'),
      ).toBeTruthy();
      expect(fixture.nativeElement.textContent).toContain('Documento Comprobante');
      expect(fixture.nativeElement.textContent).toContain('Descargar PDF');
      expect(fixture.nativeElement.textContent).toContain('Abrir WhatsApp');
      component.busqueda.set('Ana');
      component.filtroPeriodo.set('2026-11');
      component.filtroEstado.set('PAGADO');
      fixture.nativeElement.querySelector('.document-navigation a').click();
      fixture.detectChanges();
      expect(component.comprobanteOriginal()).toBeNull();
      expect(component.busqueda()).toBe('Ana');
      expect(component.filtroPeriodo()).toBe('2026-11');
      expect(component.filtroEstado()).toBe('PAGADO');
      expect(component.categoriaActiva()).toBe('INTERNET');
      expect(fixture.nativeElement.querySelector('.collections-page')).toBeTruthy();
      component.busqueda.set('');
      component.filtroPeriodo.set('');
      component.filtroEstado.set('TODOS');
    }
    expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
    expect(service.registrarPago).not.toHaveBeenCalled();
    expect(service.distribuirPago).not.toHaveBeenCalled();
  });

  it('usa la copia térmica actual para descargar y conecta Imprimir y WhatsApp', () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const imprimir = vi.spyOn(component, 'imprimirTicket').mockImplementation(() => {});
    const clickPdf = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const revocar = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue('blob:pdf-emitido'),
        revokeObjectURL: revocar,
      }),
    );
    try {
      component.abrirHistorialComprobantes(component.cobros()[0], true);
      fixture.detectChanges();
      const botones = [
        ...fixture.nativeElement.querySelectorAll('.document-toolbar button'),
      ] as HTMLButtonElement[];
      botones[0].click();
      expect(imprimir).toHaveBeenCalledOnce();
      expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
      expect(service.descargarComprobantePdfTermico).not.toHaveBeenCalled();
      botones[1].click();
      expect(service.descargarComprobantePdfTermico).toHaveBeenCalledWith(41);
      expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
      expect(clickPdf).toHaveBeenCalledOnce();
      expect(revocar).toHaveBeenCalledWith('blob:pdf-emitido');
      botones[2].click();
      expect(abrir).toHaveBeenCalledOnce();
      const enlace = new URL(abrir.mock.calls[0][0] as string);
      expect(enlace.origin + enlace.pathname).toBe('https://wa.me/50255550314');
      expect(enlace.searchParams.get('text')).toContain('COB-000001');
      expect(enlace.searchParams.get('text')).toContain('Q250.00');
      expect(abrir.mock.calls[0].slice(1)).toEqual(['_blank', 'noopener,noreferrer']);
      expect(service.registrarPago).not.toHaveBeenCalled();
    } finally {
      abrir.mockRestore();
      imprimir.mockRestore();
      clickPdf.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('no abre WhatsApp con un teléfono inválido y permite volver si falla la consulta', () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      component.abrirHistorialComprobantes(component.cobros()[0], true);
      component.ticketOriginal.update((ticket) =>
        ticket ? { ...ticket, cliente_telefono: 'javascript:123' } : null,
      );
      component.abrirWhatsAppComprobante();
      expect(abrir).not.toHaveBeenCalled();
      expect(component.errorHistorial()).toContain('WhatsApp válido');
      component.cerrarComprobanteOriginal();
      service.consultarComprobante.mockReturnValueOnce(throwError(() => new Error('404')));
      component.abrirHistorialComprobantes(component.cobros()[0], true);
      fixture.detectChanges();
      expect(component.ticketOriginal()).toBeNull();
      expect(component.errorHistorial()).toContain('No fue posible consultar');
      const botones = [
        ...fixture.nativeElement.querySelectorAll('.document-toolbar button'),
      ] as HTMLButtonElement[];
      expect(botones.every((boton) => boton.disabled)).toBe(true);
      fixture.nativeElement.querySelector('.document-navigation a').click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.collections-page')).toBeTruthy();
    } finally {
      abrir.mockRestore();
    }
  });

  it('permite elegir entre varios comprobantes y no consulta un PDF automáticamente', () => {
    component.abrirHistorialComprobantes(component.cobros()[0]);
    const original = component.comprobantesHistorial()[0];
    service.listarComprobantes.mockReturnValueOnce(
      of({
        items: [original, { ...original, id_comprobante: 42, numero: 'COB-000002' }],
        total: 2,
        page: 1,
        page_size: 50,
        total_pages: 1,
      }),
    );
    component.abrirHistorialComprobantes(component.cobros()[0], true);
    fixture.detectChanges();
    expect(component.historialAbierto()).toBe(true);
    expect(component.comprobantesHistorial()).toHaveLength(2);
    expect(component.comprobanteOriginal()).toBeNull();
    expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('COB-000002');
  });

  it('informa cuando no hay comprobante emitido sin generar documentos históricos', () => {
    service.listarComprobantes.mockReturnValueOnce(
      of({ items: [], total: 0, page: 1, page_size: 50, total_pages: 0 }),
    );
    component.abrirHistorialComprobantes(component.cobros()[0], true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('todavía no tiene comprobantes emitidos');
    expect(component.comprobanteOriginal()).toBeNull();
    expect(service.descargarComprobantePdf).not.toHaveBeenCalled();
    expect(service.registrarPago).not.toHaveBeenCalled();
  });

  it('carga clientes activos desde Cobros cuando Clientes no esta autorizado', () => {
    clientesService.getAll.mockReturnValueOnce(throwError(() => new Error('403')));
    service.listarClientesActivos.mockReturnValueOnce(of(clientes));

    const fallbackFixture = TestBed.createComponent(CobrosComponent);
    fallbackFixture.detectChanges();
    const fallbackComponent = fallbackFixture.componentInstance;

    expect(service.listarClientesActivos).toHaveBeenCalledOnce();
    expect(fallbackComponent.clientesVisuales()).toHaveLength(2);
    fallbackFixture.destroy();
  });

  it('conserva los clientes aunque falle la carga de cobros', () => {
    service.listarTodos.mockReturnValueOnce(throwError(() => new Error('cobros')));

    const clientesFixture = TestBed.createComponent(CobrosComponent);
    clientesFixture.detectChanges();
    const clientesComponent = clientesFixture.componentInstance;

    expect(clientesComponent.clientesVisuales()).toHaveLength(2);
    expect(clientesComponent.errorCarga()).toContain('cobros');
    clientesFixture.destroy();
  });

  it('conserva el intento y muestra el error cuando FastAPI rechaza el pago', () => {
    service.registrarPago.mockReturnValueOnce(throwError(() => new Error('fallo')));
    component.abrirRegistroCobro(component.cobros()[0]);
    component.abrirComprobante();

    expect(component.comprobanteAbierto()).toBe(false);
    expect(component.errorPago()).toContain('No fue posible registrar el pago');
    expect(component.modalRegistroAbierto()).toBe(true);
  });
});
