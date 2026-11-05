import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMPTY, expand, finalize, forkJoin, reduce } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { AuthService } from '../../../auth/services/auth.service';
import {
  CategoriaCaja,
  ConciliacionCaja,
  EntregaEmpleado,
  GastoEntrega,
  CierreCajaResponse,
  MetodoPagoCaja,
  MovimientoCajaDetalle,
  SesionCajaActual,
  TipoMovimientoCaja,
} from '../../models/caja.models';
import { EmpleadoReceptorCobro } from '../../models/cobros.models';
import { CajaService } from '../../services/caja.service';
import { CobrosService } from '../../services/cobros.service';

interface ApiDetailObject {
  mensaje?: string;
  disponible?: string;
  solicitado?: string;
  id_movimiento?: number;
}

// Importes en centavos para sumar la sesión completa sin errores acumulados de decimales.
interface ResumenSesion {
  entradas: number;
  salidas: number;
  cantidadEntradas: number;
  cantidadSalidas: number;
  entradasEfectivo: number;
  salidasEfectivo: number;
}

@Component({
  selector: 'app-caja-general',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './caja-general.component.html',
  styleUrl: './caja-general.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CajaGeneralComponent implements OnInit {
  private readonly cajaService = inject(CajaService);
  private readonly cobrosService = inject(CobrosService);
  private readonly auth = inject(AuthService);
  private readonly pageSize = 25;
  private consultaResumen = 0;
  private consultaSesion = 0;
  private consultaConciliacion = 0;
  private consultaHistorial = 0;
  private consultaEntrega = 0;
  private consultaEmpleadosEntrega = 0;

  readonly pestanaActiva = signal<'Entradas' | 'Salidas' | 'Cierre'>('Entradas');
  readonly resumenSesion = signal<ResumenSesion | null>(null);
  readonly errorResumen = signal('');
  readonly saldoEsperado = computed(() => {
    const resumen = this.resumenSesion();
    const sesion = this.sesion();
    return resumen && sesion
      ? (Math.round(Number(sesion.saldo_inicial) * 100) + resumen.entradas - resumen.salidas) / 100
      : null;
  });

  readonly sesion = signal<SesionCajaActual | null>(null);
  readonly movimientos = signal<MovimientoCajaDetalle[]>([]);
  readonly totalMovimientos = signal(0);
  readonly pagina = signal(1);
  readonly totalPaginas = signal(0);
  readonly cargandoSesion = signal(false);
  readonly cargandoMovimientos = signal(false);
  readonly cargandoCatalogos = signal(false);
  readonly abriendoCaja = signal(false);
  readonly guardandoMovimiento = signal(false);
  readonly errorCarga = signal('');
  readonly errorCatalogos = signal('');
  readonly errorOperacion = signal('');
  readonly mensajeExito = signal('');
  readonly modalAperturaAbierto = signal(false);
  readonly modalMovimientoAbierto = signal(false);
  readonly saldoInicial = signal('');
  readonly categorias = signal<CategoriaCaja[]>([]);
  readonly metodosPago = signal<MetodoPagoCaja[]>([]);
  readonly tipoMovimiento = signal<TipoMovimientoCaja>('Ingreso');
  readonly idCategoriaMovimiento = signal<number | null>(null);
  readonly idMetodoMovimiento = signal<number | null>(null);
  readonly conceptoMovimiento = signal('');
  readonly montoMovimiento = signal('');
  readonly referenciaMovimiento = signal('');
  readonly observacionesMovimiento = signal('');
  readonly movimientoSeleccionado = signal<MovimientoCajaDetalle | null>(null);
  readonly filtroTipo = signal<'' | TipoMovimientoCaja>('Ingreso');
  readonly fechaDesde = signal('');
  readonly fechaHasta = signal('');

  readonly modalCierreAbierto = signal(false);
  readonly cerrandoCaja = signal(false);
  readonly efectivoContado = signal('');
  readonly observacionesCierre = signal('');
  readonly errorCierre = signal('');
  readonly cierreConfirmado = signal<CierreCajaResponse | null>(null);
  readonly confirmacionCierreAbierta = signal(false);
  readonly entregasCierreCaja = signal<EntregaEmpleado[]>([]);
  readonly cargandoEntregasCierreCaja = signal(false);
  readonly errorEntregasCierreCaja = signal('');
  readonly conciliacion = signal<ConciliacionCaja | null>(null);
  readonly errorConciliacion = signal('');
  readonly cargandoConciliacion = signal(false);
  readonly modalEntregaAbierto = signal(false);
  readonly guardandoEntrega = signal(false);
  readonly cargandoEmpleadosEntrega = signal(false);
  readonly errorEmpleadosEntrega = signal('');
  readonly empleadosReceptoresEntrega = signal<EmpleadoReceptorCobro[]>([]);
  readonly busquedaEmpleadoEntrega = signal('');
  readonly empleadoEntregaId = signal<number | null>(null);
  readonly pagosEntrega = signal<ReadonlySet<number>>(new Set());
  readonly gastosEntrega = signal<GastoEntrega[]>([]);
  readonly montoEntrega = signal('');
  readonly observacionesEntrega = signal('');
  readonly autorizarGastosEntrega = signal(false);
  readonly errorEntrega = signal('');
  readonly historialEntregas = signal<EntregaEmpleado[]>([]);
  readonly entregaSeleccionada = signal<EntregaEmpleado | null>(null);
  private claveEntrega: string | null = null;
  readonly empleadoEntrega = computed(() => this.conciliacion()?.empleados.find(e => e.id_empleado === this.empleadoEntregaId()) ?? null);
  readonly empleadoReceptorSeleccionado = computed(() =>
    this.empleadosReceptoresEntrega().find(e => e.id_empleado === this.empleadoEntregaId()) ?? null);
  readonly empleadosPendientes = computed(() => this.conciliacion()?.empleados.filter(e => Number(e.pendiente) > 0) ?? []);
  // El catálogo define quién es elegible; la conciliación aporta únicamente su saldo real.
  readonly empleadosEntrega = computed(() => this.empleadosReceptoresEntrega().map(empleado => {
    const conciliado = this.conciliacion()?.empleados.find(item => item.id_empleado === empleado.id_empleado);
    return {
      id_empleado: empleado.id_empleado,
      codigo: empleado.codigo,
      empleado: `${empleado.nombres} ${empleado.apellidos}`.trim(),
      pendiente: conciliado?.pendiente ?? 0,
    };
  }));
  readonly empleadosEntregaFiltrados = computed(() => {
    const termino = this.normalizarBusqueda(this.busquedaEmpleadoEntrega());
    if (!termino) return this.empleadosEntrega();
    return this.empleadosEntrega().filter(empleado =>
      this.normalizarBusqueda(`${empleado.codigo} ${empleado.empleado}`).includes(termino));
  });
  readonly cantidadCobrosPendientes = computed(() => this.empleadosPendientes()
    .reduce((total, empleado) => total + empleado.pagos_pendientes.length, 0));
  readonly totalPendienteCobradores = computed(() => this.empleadosPendientes()
    .reduce((total, empleado) => total + Math.round(Number(empleado.pendiente) * 100), 0) / 100);
  // Distingue carga, error, ausencia real y pagos históricos no imputables.
  readonly mensajePendientesEntrega = computed(() => {
    if (this.cargandoConciliacion()) return 'Cargando cobros pendientes...';
    if (this.errorConciliacion()) return 'No fue posible cargar los cobros pendientes.';
    if (this.empleadoEntregaId() !== null) return 'No hay pagos pendientes para el empleado seleccionado.';
    if (this.empleadosPendientes().length) return 'Seleccione un empleado para consultar sus cobros pendientes.';
    if ((this.conciliacion()?.historicos.length ?? 0) > 0) {
      return 'No hay cobros clasificados por empleado. Los pagos históricos sin clasificación no se atribuyen a ningún empleado.';
    }
    return 'No hay cobros pendientes registrados por empleados en esta sesión.';
  });
  readonly recaudadoEntrega = computed(() => (this.empleadoEntrega()?.pagos_pendientes ?? [])
    .filter(p => this.pagosEntrega().has(p.id_pago)).reduce((total, p) => total + Math.round(Number(p.pendiente) * 100), 0) / 100);
  readonly totalGastosEntrega = computed(() => this.gastosEntrega().reduce((total, g) => total + Math.round(g.monto * 100), 0) / 100);
  readonly netoEntrega = computed(() => Math.round((this.recaudadoEntrega() - this.totalGastosEntrega()) * 100) / 100);
  readonly efectivoRecibidoEntrega = computed(() => {
    const monto = Number(this.montoEntrega());
    return Number.isFinite(monto) ? monto : 0;
  });
  readonly diferenciaEntrega = computed(() =>
    (Math.round(this.efectivoRecibidoEntrega() * 100) - Math.round(this.netoEntrega() * 100)) / 100);
  readonly puedeEntregar = computed(() => this.sesion()?.estado === 'Abierta'
    && this.auth.isAdministrator() && this.auth.hasModule('caja') && !this.guardandoEntrega()
    && !this.cargandoSesion() && !this.cerrandoCaja());
  readonly entregaValida = computed(() => this.puedeEntregar() && !this.cargandoConciliacion()
    && !this.errorConciliacion() && this.pagosEntrega().size > 0 && this.netoEntrega() >= 0
    && /^\d+(?:\.\d{1,2})?$/.test(this.montoEntrega())
    && Math.round(Number(this.montoEntrega()) * 100) === Math.round(this.netoEntrega() * 100)
    && this.gastosEntrega().every(g => g.concepto.trim().length > 0 && Number.isFinite(g.monto) && g.monto > 0)
    && (!this.gastosEntrega().length || this.autorizarGastosEntrega()));

  // El resumen general conserva todos los métodos; el arqueo físico usa solo efectivo.
  readonly efectivoEsperado = computed(() => {
    const resumen = this.conciliacion();
    // El servidor es autoritativo; NULL impide fingir un arqueo físico de históricos.
    return resumen && resumen.efectivo_esperado !== null ? Number(resumen.efectivo_esperado) : null;
  });
  readonly efectivoContadoValido = computed(() => {
    const valor = this.efectivoContado().trim();
    const monto = Number(valor);
    // Coincide con numeric(10,2): cero es válido, vacío, negativos y más de dos decimales no.
    return /^\d+(?:\.\d{1,2})?$/.test(valor) && Number.isFinite(monto) && monto >= 0 && monto <= 99999999.99;
  });
  readonly diferenciaCierre = computed(() => {
    const esperado = this.efectivoEsperado();
    return this.efectivoContadoValido() && esperado !== null
      ? (Math.round(Number(this.efectivoContado()) * 100) - Math.round(esperado * 100)) / 100
      : null;
  });
  readonly resumenEntregasCierreCaja = computed(() => {
    const empleados = new Map<number, { id_empleado: number; empleado: string; entregado: number; recibido: number }>();
    for (const entrega of this.entregasCierreCaja()) {
      const actual = empleados.get(entrega.id_empleado) ?? {
        id_empleado: entrega.id_empleado,
        empleado: entrega.empleado,
        entregado: 0,
        recibido: 0,
      };
      actual.entregado = (Math.round(actual.entregado * 100) + Math.round(Number(entrega.monto_entregado) * 100)) / 100;
      actual.recibido = (Math.round(actual.recibido * 100) + Math.round(Number(entrega.recaudado) * 100)) / 100;
      empleados.set(entrega.id_empleado, actual);
    }
    return [...empleados.values()];
  });
  readonly totalRecibidoCobradores = computed(() => this.resumenEntregasCierreCaja()
    .reduce((total, entrega) => total + Math.round(entrega.recibido * 100), 0) / 100);
  readonly puedeRevisarCierreCaja = computed(() => {
    const sesion = this.sesion();
    const usuario = this.auth.currentUser();
    return sesion?.estado === 'Abierta' && usuario?.activo === true &&
      this.auth.isAdministrator() && this.auth.hasModule('caja') &&
      !this.cargandoSesion() && !this.guardandoEntrega() && !this.cerrandoCaja() &&
      usuario.empleado?.id_empleado === sesion.id_empleado;
  });
  readonly puedeCerrarCaja = computed(() => {
    // Es una condición visual; FastAPI repite permisos e identidad contra PostgreSQL.
    return this.puedeRevisarCierreCaja() &&
      this.conciliacion()?.efectivo_esperado !== null && !!this.conciliacion() &&
      !this.cargandoConciliacion() && !this.errorConciliacion() &&
      Number(this.conciliacion()?.pendiente_entrega ?? 0) === 0;
  });

  readonly saldoInicialValido = computed(() => {
    const valor = this.saldoInicial().trim();
    const monto = Number(valor);
    return /^\d+(?:\.\d{1,2})?$/.test(valor) && Number.isFinite(monto) && monto >= 0;
  });
  readonly puedeRetroceder = computed(() => this.pagina() > 1 && !this.cargandoMovimientos());
  readonly puedeAvanzar = computed(
    () => this.pagina() < this.totalPaginas() && !this.cargandoMovimientos(),
  );
  readonly categoriasCompatibles = computed(() => {
    const tipo = this.tipoMovimiento();
    const nombreManual = tipo === 'Ingreso' ? 'Entrada' : 'Salida';
    return this.categorias().filter(
      (categoria) =>
        categoria.estado === 'Activo' &&
        categoria.tipo === tipo &&
        categoria.nombre === nombreManual,
    );
  });
  readonly metodosActivos = computed(() =>
    this.metodosPago().filter((metodo) => metodo.estado === 'Activo'),
  );
  readonly tieneEntradasManuales = computed(() =>
    this.categorias().some(
      (categoria) =>
        categoria.estado === 'Activo' &&
        categoria.tipo === 'Ingreso' &&
        categoria.nombre === 'Entrada',
    ),
  );
  readonly tieneSalidasManuales = computed(() =>
    this.categorias().some(
      (categoria) =>
        categoria.estado === 'Activo' &&
        categoria.tipo === 'Egreso' &&
        categoria.nombre === 'Salida',
    ),
  );
  readonly puedeRegistrarMovimiento = computed(
    () =>
      this.sesion()?.estado === 'Abierta' &&
      !this.cerrandoCaja() &&
      !this.cargandoCatalogos() &&
      !this.errorCatalogos() &&
      this.metodosActivos().length > 0 &&
      (this.tieneEntradasManuales() || this.tieneSalidasManuales()),
  );
  readonly metodoSeleccionado = computed(
    () =>
      this.metodosActivos().find((metodo) => metodo.id_metodo_pago === this.idMetodoMovimiento()) ??
      null,
  );
  readonly requiereReferencia = computed(
    () => this.metodoSeleccionado()?.nombre.trim().toLocaleLowerCase('es') !== 'efectivo',
  );
  readonly montoMovimientoValido = computed(() => {
    const valor = this.montoMovimiento().trim();
    const monto = Number(valor);
    return /^\d+(?:\.\d{1,2})?$/.test(valor) && Number.isFinite(monto) && monto > 0;
  });
  readonly formularioMovimientoValido = computed(() => {
    const categoriaValida = this.categoriasCompatibles().some(
      (categoria) => categoria.id_categoria === this.idCategoriaMovimiento(),
    );
    return (
      categoriaValida &&
      this.metodoSeleccionado() !== null &&
      this.conceptoMovimiento().trim().length > 0 &&
      this.montoMovimientoValido() &&
      (!this.requiereReferencia() || this.referenciaMovimiento().trim().length > 0)
    );
  });

  ngOnInit(): void {
    this.cargarSesion();
  }

  cargarSesion(): void {
    // Una actualización invalida la custodia anterior hasta recibir el estado vigente.
    const consulta = ++this.consultaSesion;
    this.consultaConciliacion++;
    this.consultaHistorial++;
    this.consultaEntrega++;
    this.conciliacion.set(null);
    this.cargandoConciliacion.set(false);
    this.cargandoSesion.set(true);
    this.errorCarga.set('');
    this.cajaService
      .obtenerSesionActual()
      .pipe(finalize(() => {
        if (consulta === this.consultaSesion) this.cargandoSesion.set(false);
      }))
      .subscribe({
        next: (sesion) => {
          if (consulta !== this.consultaSesion) return;
          this.sesion.set(sesion);
          this.pagina.set(1);
          this.cargarCatalogos();
          this.cargarResumen();
          this.cargarMovimientos();
        },
        error: (error: unknown) => {
          if (consulta !== this.consultaSesion) return;
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.sesion.set(null);
            this.consultaResumen++;
            this.resumenSesion.set(null);
            this.historialEntregas.set([]);
            this.cargandoConciliacion.set(false);
            this.errorResumen.set('');
            this.limpiarCatalogos();
            this.limpiarMovimientos();
            return;
          }
          this.errorCarga.set(
            this.mensajeError(error, 'No fue posible consultar el estado de Caja General.'),
          );
        },
      });
  }

  cargarCatalogos(): void {
    if (!this.sesion()) {
      this.limpiarCatalogos();
      return;
    }

    this.cargandoCatalogos.set(true);
    this.errorCatalogos.set('');
    forkJoin({
      ingresos: this.cajaService.listarCategorias('Ingreso'),
      egresos: this.cajaService.listarCategorias('Egreso'),
      metodos: this.cajaService.listarMetodosPago(),
    })
      .pipe(finalize(() => this.cargandoCatalogos.set(false)))
      .subscribe({
        next: ({ ingresos, egresos, metodos }) => {
          this.categorias.set([...ingresos, ...egresos]);
          this.metodosPago.set(metodos);
        },
        error: (error: unknown) => {
          this.limpiarCatalogos();
          this.errorCatalogos.set(
            this.mensajeError(error, 'No fue posible consultar los catálogos de Caja General.'),
          );
        },
      });
  }

  cargarMovimientos(): void {
    const sesion = this.sesion();
    if (!sesion) {
      this.limpiarMovimientos();
      return;
    }

    this.cargandoMovimientos.set(true);
    this.errorCarga.set('');
    this.cajaService
      .listarMovimientos({
        page: this.pagina(),
        page_size: this.pageSize,
        id_sesion: sesion.id_sesion,
        tipo: this.filtroTipo() || undefined,
        fecha_desde: this.fechaDesde() || undefined,
        fecha_hasta: this.fechaHasta() || undefined,
      })
      .pipe(finalize(() => this.cargandoMovimientos.set(false)))
      .subscribe({
        next: (respuesta) => {
          this.movimientos.set(respuesta.items);
          this.totalMovimientos.set(respuesta.total);
          this.pagina.set(respuesta.page);
          this.totalPaginas.set(respuesta.total_pages);
        },
        error: (error: unknown) =>
          this.errorCarga.set(
            this.mensajeError(error, 'No fue posible cargar los movimientos de la sesión.'),
          ),
      });
  }

  // Consulta todas las páginas sin filtros de fecha ni tipo: el resumen y los
  // contadores pertenecen a toda la sesión, incluidos los ingresos automáticos.
  // Solo publica resultados completos; un error nunca presenta totales parciales.
  cargarResumen(): void {
    const sesion = this.sesion();
    if (!sesion) return;
    this.cargarConciliacion();
    const consulta = ++this.consultaResumen;
    this.resumenSesion.set(null);
    this.errorResumen.set('');
    const consultarPagina = (page: number) => this.cajaService.listarMovimientos({
      page,
      page_size: this.pageSize,
      id_sesion: sesion.id_sesion,
    });
    consultarPagina(1).pipe(
      expand((pagina) => pagina.page < pagina.total_pages
        ? consultarPagina(pagina.page + 1)
        : EMPTY),
      reduce((resumen: ResumenSesion, pagina) => {
        for (const movimiento of pagina.items) {
          const monto = Math.round(Number(movimiento.monto) * 100);
          if (movimiento.tipo === 'Ingreso') {
            resumen.entradas += monto;
            resumen.cantidadEntradas++;
            if (movimiento.es_efectivo) resumen.entradasEfectivo += monto;
          } else {
            resumen.salidas += monto;
            resumen.cantidadSalidas++;
            if (movimiento.es_efectivo) resumen.salidasEfectivo += monto;
          }
        }
        return resumen;
      }, { entradas: 0, salidas: 0, cantidadEntradas: 0, cantidadSalidas: 0, entradasEfectivo: 0, salidasEfectivo: 0 }),
    ).subscribe({
      next: (resumen) => {
        // Ignora respuestas de una actualización anterior de la sesión.
        if (consulta === this.consultaResumen) this.resumenSesion.set(resumen);
      },
      error: (error: unknown) => {
        if (consulta === this.consultaResumen) {
          this.errorResumen.set(this.mensajeError(error, 'No fue posible calcular el resumen completo.'));
        }
      },
    });
  }

  cargarConciliacion(): void {
    const sesion = this.sesion();
    if (!sesion) return;
    const consulta = ++this.consultaConciliacion;
    this.cargandoConciliacion.set(true);
    this.errorConciliacion.set('');
    this.cajaService.conciliacion(sesion.id_sesion)
      .pipe(finalize(() => {
        if (consulta === this.consultaConciliacion) this.cargandoConciliacion.set(false);
      }))
      .subscribe({
        next: resumen => {
          // También compara versiones dentro de la misma sesión: pueden llegar fuera de orden.
          if (consulta === this.consultaConciliacion && this.sesion()?.id_sesion === resumen.id_sesion) this.conciliacion.set(resumen);
        },
        error: error => {
          if (consulta === this.consultaConciliacion) this.errorConciliacion.set(this.mensajeError(error, 'No fue posible conciliar la custodia del efectivo.'));
        },
      });
  }

  abrirCierreEmpleado(): void {
    if (!this.sesion() || !this.auth.isAdministrator() || !this.auth.hasModule('caja') || this.guardandoEntrega()) return;
    this.empleadoEntregaId.set(null);
    this.busquedaEmpleadoEntrega.set('');
    this.pagosEntrega.set(new Set());
    this.gastosEntrega.set([]);
    this.montoEntrega.set('');
    this.observacionesEntrega.set('');
    this.autorizarGastosEntrega.set(false);
    this.entregaSeleccionada.set(null);
    this.consultaEntrega++;
    this.errorEntrega.set('');
    this.mensajeExito.set('');
    this.claveEntrega = null;
    this.modalEntregaAbierto.set(true);
    this.cargarEmpleadosReceptoresEntrega();
    this.cargarConciliacion();
    this.cargarHistorialEntregas();
  }

  cargarEmpleadosReceptoresEntrega(): void {
    const consulta = ++this.consultaEmpleadosEntrega;
    this.cargandoEmpleadosEntrega.set(true);
    this.errorEmpleadosEntrega.set('');
    this.cobrosService.listarEmpleadosReceptores()
      .pipe(finalize(() => {
        if (consulta === this.consultaEmpleadosEntrega) this.cargandoEmpleadosEntrega.set(false);
      }))
      .subscribe({
        next: empleados => {
          if (consulta === this.consultaEmpleadosEntrega) this.empleadosReceptoresEntrega.set(empleados);
        },
        error: error => {
          if (consulta === this.consultaEmpleadosEntrega) {
            this.empleadosReceptoresEntrega.set([]);
            this.errorEmpleadosEntrega.set(this.mensajeError(error, 'No fue posible consultar los empleados activos.'));
          }
        },
      });
  }

  cerrarCierreEmpleado(): void {
    if (!this.guardandoEntrega()) this.modalEntregaAbierto.set(false);
  }

  seleccionarEmpleadoEntrega(event: Event): void {
    this.seleccionarEmpleadoEntregaPorId(Number((event.target as HTMLSelectElement).value) || null);
  }

  seleccionarEmpleadoEntregaPorId(idEmpleado: number | null): void {
    this.consultaEntrega++;
    this.entregaSeleccionada.set(null);
    this.empleadoEntregaId.set(idEmpleado);
    this.pagosEntrega.set(new Set((this.empleadoEntrega()?.pagos_pendientes ?? []).map(p => p.id_pago)));
    this.gastosEntrega.set([]);
    this.autorizarGastosEntrega.set(false);
    this.recalcularEntrega();
    this.cargarHistorialEntregas();
  }

  actualizarBusquedaEmpleadoEntrega(event: Event): void {
    this.busquedaEmpleadoEntrega.set((event.target as HTMLInputElement).value);
  }

  // Limpia el formulario y vuelve al historial general sin cerrar el modal.
  limpiarCierreEmpleado(): void {
    if (this.guardandoEntrega()) return;
    this.consultaEntrega++;
    this.empleadoEntregaId.set(null);
    this.busquedaEmpleadoEntrega.set('');
    this.pagosEntrega.set(new Set());
    this.gastosEntrega.set([]);
    this.montoEntrega.set('');
    this.observacionesEntrega.set('');
    this.autorizarGastosEntrega.set(false);
    this.entregaSeleccionada.set(null);
    this.errorEntrega.set('');
    this.mensajeExito.set('');
    this.claveEntrega = null;
    this.cargarHistorialEntregas();
  }

  alternarPagoEntrega(id: number): void {
    const ids = new Set(this.pagosEntrega());
    ids.has(id) ? ids.delete(id) : ids.add(id);
    this.pagosEntrega.set(ids);
    this.recalcularEntrega();
  }

  agregarGastoEntrega(): void {
    this.gastosEntrega.update(gastos => [...gastos, { concepto: '', monto: 0, observaciones: null }]);
    this.autorizarGastosEntrega.set(false);
    this.recalcularEntrega();
  }

  actualizarGastoEntrega(indice: number, campo: 'concepto' | 'monto' | 'observaciones', event: Event): void {
    const valor = (event.target as HTMLInputElement).value;
    this.gastosEntrega.update(gastos => gastos.map((gasto, i) => i !== indice ? gasto
      : { ...gasto, [campo]: campo === 'monto' ? Number(valor) : valor }));
    this.autorizarGastosEntrega.set(false);
    this.recalcularEntrega();
  }

  quitarGastoEntrega(indice: number): void {
    this.gastosEntrega.update(gastos => gastos.filter((_, i) => i !== indice));
    this.autorizarGastosEntrega.set(false);
    this.recalcularEntrega();
  }

  actualizarDatosEntrega(campo: 'monto' | 'observaciones' | 'autorizar', event: Event): void {
    const control = event.target as HTMLInputElement;
    if (campo === 'monto') this.montoEntrega.set(control.value);
    if (campo === 'observaciones') this.observacionesEntrega.set(control.value);
    if (campo === 'autorizar') this.autorizarGastosEntrega.set(control.checked);
    this.claveEntrega = null;
  }

  private recalcularEntrega(): void {
    this.montoEntrega.set(Math.max(0, this.netoEntrega()).toFixed(2));
    this.claveEntrega = null;
    this.errorEntrega.set('');
  }

  confirmarEntrega(event: Event): void {
    event.preventDefault();
    const sesion = this.sesion();
    const empleado = this.empleadoEntregaId();
    if (!sesion || !empleado || !this.entregaValida()) return;
    // Conserva UUID en errores/reintentos; solo editar datos inicia otra operación.
    this.claveEntrega ??= crypto.randomUUID();
    this.guardandoEntrega.set(true);
    this.errorEntrega.set('');
    this.cajaService.registrarEntrega({
      id_sesion: sesion.id_sesion, id_empleado: empleado,
      ids_pagos: [...this.pagosEntrega()], clave_idempotencia: this.claveEntrega,
      monto_entregado: Number(this.montoEntrega()),
      gastos: this.gastosEntrega().map(g => ({ ...g, concepto: g.concepto.trim(), observaciones: g.observaciones?.trim() || null })),
      autorizar_gastos: this.autorizarGastosEntrega(), observaciones: this.observacionesEntrega().trim() || null,
    }).pipe(finalize(() => this.guardandoEntrega.set(false))).subscribe({
      next: entrega => {
        this.consultaEntrega++;
        this.entregaSeleccionada.set(entrega);
        this.pagosEntrega.set(new Set());
        this.gastosEntrega.set([]);
        this.claveEntrega = null;
        this.mensajeExito.set('Entrega confirmada. El resumen de Caja se actualizó sin registrar otro ingreso.');
        this.cargarSesion();
        this.cargarHistorialEntregas();
      },
      error: error => this.errorEntrega.set(this.mensajeError(error, 'No fue posible confirmar la entrega.')),
    });
  }

  cargarHistorialEntregas(): void {
    const sesion = this.sesion();
    if (!sesion) return;
    const consulta = ++this.consultaHistorial;
    this.historialEntregas.set([]);
    this.cajaService.listarEntregas(sesion.id_sesion, this.empleadoEntregaId() ?? undefined).subscribe({
      next: entregas => {
        if (consulta === this.consultaHistorial) this.historialEntregas.set(entregas);
      },
      error: () => {
        if (consulta === this.consultaHistorial) this.errorEntrega.set('No fue posible consultar el historial de entregas.');
      },
    });
  }

  verEntrega(id: number): void {
    const consulta = ++this.consultaEntrega;
    this.cajaService.detalleEntrega(id).subscribe({
      next: entrega => {
        if (consulta === this.consultaEntrega) this.entregaSeleccionada.set(entrega);
      },
      error: () => {
        if (consulta === this.consultaEntrega) this.errorEntrega.set('No fue posible consultar el detalle de entrega.');
      },
    });
  }

  // Las pestañas reutilizan el filtro de tipo y la paginación existentes.
  seleccionarPestana(pestana: 'Entradas' | 'Salidas' | 'Cierre'): void {
    this.pestanaActiva.set(pestana);
    if (pestana === 'Cierre') return;
    this.filtroTipo.set(pestana === 'Entradas' ? 'Ingreso' : 'Egreso');
    this.aplicarFiltros();
  }

  // Vuelve a consultar todas las páginas al abrir el arqueo y bloquea el envío
  // hasta disponer de un resumen completo, independiente de filtros y paginación.
  abrirModalCierre(): void {
    if (!this.puedeRevisarCierreCaja() || this.cargandoSesion() || this.cerrandoCaja()) return;
    this.efectivoContado.set('');
    this.observacionesCierre.set('');
    this.errorCierre.set('');
    this.modalCierreAbierto.set(true);
    this.cargarEntregasCierreCaja();
    this.cargarResumen();
  }

  // El cierre presenta el consolidado de entregas sin reutilizar el filtro del modal de cobradores.
  cargarEntregasCierreCaja(): void {
    const sesion = this.sesion();
    if (!sesion) return;
    this.cargandoEntregasCierreCaja.set(true);
    this.errorEntregasCierreCaja.set('');
    this.cajaService.listarEntregas(sesion.id_sesion)
      .pipe(finalize(() => this.cargandoEntregasCierreCaja.set(false)))
      .subscribe({
        next: entregas => this.entregasCierreCaja.set(entregas),
        error: error => {
          this.entregasCierreCaja.set([]);
          this.errorEntregasCierreCaja.set(this.mensajeError(error, 'No fue posible consultar las entregas de cobradores.'));
        },
      });
  }

  cerrarModalCierre(): void {
    if (!this.cerrandoCaja()) this.modalCierreAbierto.set(false);
  }

  actualizarEfectivoContado(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.efectivoContado.set(event.target.value);
  }

  actualizarObservacionesCierre(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) this.observacionesCierre.set(event.target.value);
  }

  confirmarCierre(event: Event): void {
    event.preventDefault();
    const sesion = this.sesion();
    const esperado = this.efectivoEsperado();
    if (!this.puedeCerrarCaja() || !sesion || esperado === null ||
        !this.efectivoContadoValido() || this.cerrandoCaja() || this.cargandoSesion()) return;
    // Abre la ventana de confirmación en lugar de usar window.confirm.
    // El cierre definitivo se ejecuta desde confirmarCierreDefinitivo().
    this.confirmacionCierreAbierta.set(true);
    return;
  }

  // Ejecuta el cierre tras la confirmación explícita del usuario.
  // Conserva la misma protección contra ejecuciones duplicadas que el cierre original.
  confirmarCierreDefinitivo(): void {
    this.confirmacionCierreAbierta.set(false);
    const sesion = this.sesion();
    const esperado = this.efectivoEsperado();
    if (!this.puedeCerrarCaja() || !sesion || esperado === null ||
        !this.efectivoContadoValido() || this.cerrandoCaja() || this.cargandoSesion()) return;

    this.cerrandoCaja.set(true);
    this.errorCierre.set('');
    this.cajaService.cerrar(sesion.id_sesion, {
      monto_contado: Number(this.efectivoContado()),
      monto_sistema: esperado,
      observaciones: this.observacionesCierre().trim() || null,
    }).pipe(finalize(() => this.cerrandoCaja.set(false))).subscribe({
      next: (cierre) => {
        this.cierreConfirmado.set(cierre);
        this.sesion.set(cierre);
        this.modalCierreAbierto.set(false);
        this.modalMovimientoAbierto.set(false);
        this.pestanaActiva.set('Cierre');
        this.mensajeExito.set('Caja General cerrada correctamente.');
        // Conserva el historial de la sesión cerrada; no busca una sesión abierta distinta.
        this.cargarResumen();
        this.cargarMovimientos();
      },
      error: (error: unknown) => {
        this.errorCierre.set(this.mensajeError(error, 'No fue posible cerrar Caja General.'));
        // Recalcula la vista si aparecieron movimientos después de la revisión.
        if (error instanceof HttpErrorResponse && error.status === 409) this.cargarResumen();
      },
    });
  }

  cancelarConfirmacionCierre(): void {
    if (!this.cerrandoCaja()) {
      this.confirmacionCierreAbierta.set(false);
    }
  }

  abrirModalApertura(): void {
    this.saldoInicial.set('');
    this.errorOperacion.set('');
    this.mensajeExito.set('');
    this.modalAperturaAbierto.set(true);
  }

  cerrarModalApertura(): void {
    if (!this.abriendoCaja()) {
      this.modalAperturaAbierto.set(false);
    }
  }

  actualizarSaldoInicial(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.saldoInicial.set(input.value);
    }
  }

  confirmarApertura(event: Event): void {
    event.preventDefault();
    if (!this.saldoInicialValido() || this.abriendoCaja()) {
      this.errorOperacion.set(
        'Ingrese un saldo inicial válido, mayor o igual a cero y con máximo dos decimales.',
      );
      return;
    }

    this.abriendoCaja.set(true);
    this.errorOperacion.set('');
    this.cajaService
      .abrir({ saldo_inicial: Number(this.saldoInicial()) })
      .pipe(finalize(() => this.abriendoCaja.set(false)))
      .subscribe({
        next: (sesion) => {
          this.sesion.set(sesion);
          this.modalAperturaAbierto.set(false);
          this.cierreConfirmado.set(null);
          this.mensajeExito.set('Caja General abierta correctamente.');
          this.pagina.set(1);
          this.cargarCatalogos();
          this.cargarResumen();
          this.cargarMovimientos();
        },
        error: (error: unknown) =>
          this.errorOperacion.set(this.mensajeError(error, 'No fue posible abrir Caja General.')),
      });
  }

  // Preselecciona entrada o salida sin duplicar el formulario ni sus validaciones.
  abrirModalMovimiento(tipo?: TipoMovimientoCaja): void {
    if (!this.puedeRegistrarMovimiento() ||
        (tipo === 'Ingreso' && !this.tieneEntradasManuales()) ||
        (tipo === 'Egreso' && !this.tieneSalidasManuales())) {
      return;
    }
    this.reiniciarMovimiento();
    const tipoInicial = tipo ?? (this.tieneEntradasManuales() ? 'Ingreso' : 'Egreso');
    this.tipoMovimiento.set(tipoInicial);
    this.idCategoriaMovimiento.set(this.categoriasCompatibles()[0]?.id_categoria ?? null);
    this.idMetodoMovimiento.set(this.metodosActivos()[0]?.id_metodo_pago ?? null);
    this.modalMovimientoAbierto.set(true);
  }

  cerrarModalMovimiento(): void {
    if (!this.guardandoMovimiento()) {
      this.modalMovimientoAbierto.set(false);
      this.errorOperacion.set('');
    }
  }

  actualizarTipoMovimiento(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.tipoMovimiento.set(select.value as TipoMovimientoCaja);
      this.idCategoriaMovimiento.set(this.categoriasCompatibles()[0]?.id_categoria ?? null);
    }
  }

  actualizarCategoriaMovimiento(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.idCategoriaMovimiento.set(Number(select.value) || null);
    }
  }

  actualizarMetodoMovimiento(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.idMetodoMovimiento.set(Number(select.value) || null);
      if (!this.requiereReferencia()) {
        this.referenciaMovimiento.set('');
      }
    }
  }

  actualizarConceptoMovimiento(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.conceptoMovimiento.set(input.value);
    }
  }

  actualizarMontoMovimiento(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.montoMovimiento.set(input.value);
    }
  }

  actualizarReferenciaMovimiento(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.referenciaMovimiento.set(input.value);
    }
  }

  actualizarObservacionesMovimiento(event: Event): void {
    const textarea = event.target;
    if (textarea instanceof HTMLTextAreaElement) {
      this.observacionesMovimiento.set(textarea.value);
    }
  }

  confirmarMovimiento(event: Event): void {
    event.preventDefault();
    const idCategoria = this.idCategoriaMovimiento();
    const idMetodoPago = this.idMetodoMovimiento();
    if (
      !this.formularioMovimientoValido() ||
      this.sesion()?.estado !== 'Abierta' ||
      this.cerrandoCaja() ||
      idCategoria === null ||
      idMetodoPago === null ||
      this.guardandoMovimiento()
    ) {
      this.errorOperacion.set('Revise los campos obligatorios y la referencia del movimiento.');
      return;
    }

    this.guardandoMovimiento.set(true);
    this.errorOperacion.set('');
    this.cajaService
      .registrarMovimiento({
        tipo: this.tipoMovimiento(),
        id_categoria: idCategoria,
        concepto: this.conceptoMovimiento().trim(),
        monto: Number(this.montoMovimiento()),
        id_metodo_pago: idMetodoPago,
        referencia: this.referenciaMovimiento().trim() || null,
        observaciones: this.observacionesMovimiento().trim() || null,
      })
      .pipe(finalize(() => this.guardandoMovimiento.set(false)))
      .subscribe({
        next: () => {
          this.modalMovimientoAbierto.set(false);
          this.reiniciarMovimiento();
          this.mensajeExito.set('Movimiento de Caja registrado correctamente.');
          // La sesión se vuelve a consultar para reflejar el efectivo calculado en servidor.
          this.cargarSesion();
        },
        error: (error: unknown) =>
          this.errorOperacion.set(
            this.mensajeError(error, 'No fue posible registrar el movimiento de Caja.'),
          ),
      });
  }

  actualizarTipo(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.filtroTipo.set(select.value as '' | TipoMovimientoCaja);
    }
  }

  actualizarFechaDesde(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.fechaDesde.set(input.value);
    }
  }

  actualizarFechaHasta(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.fechaHasta.set(input.value);
    }
  }

  aplicarFiltros(): void {
    this.pagina.set(1);
    this.cargarMovimientos();
  }

  limpiarFiltros(): void {
    // Limpiar fechas conserva el tipo seleccionado mediante la pestaña.
    this.filtroTipo.set(this.pestanaActiva() === 'Salidas' ? 'Egreso' : 'Ingreso');
    this.fechaDesde.set('');
    this.fechaHasta.set('');
    this.aplicarFiltros();
  }

  paginaAnterior(): void {
    if (this.puedeRetroceder()) {
      this.pagina.update((pagina) => pagina - 1);
      this.cargarMovimientos();
    }
  }

  paginaSiguiente(): void {
    if (this.puedeAvanzar()) {
      this.pagina.update((pagina) => pagina + 1);
      this.cargarMovimientos();
    }
  }

  verDetalle(movimiento: MovimientoCajaDetalle): void {
    this.movimientoSeleccionado.set(movimiento);
  }

  cerrarDetalle(): void {
    this.movimientoSeleccionado.set(null);
  }

  limpiarMensaje(): void {
    this.mensajeExito.set('');
  }

  private normalizarBusqueda(valor: string): string {
    return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
  }

  private limpiarMovimientos(): void {
    this.movimientos.set([]);
    this.totalMovimientos.set(0);
    this.pagina.set(1);
    this.totalPaginas.set(0);
  }

  private limpiarCatalogos(): void {
    this.categorias.set([]);
    this.metodosPago.set([]);
    this.errorCatalogos.set('');
  }

  private reiniciarMovimiento(): void {
    this.tipoMovimiento.set('Ingreso');
    this.idCategoriaMovimiento.set(null);
    this.idMetodoMovimiento.set(null);
    this.conceptoMovimiento.set('');
    this.montoMovimiento.set('');
    this.referenciaMovimiento.set('');
    this.observacionesMovimiento.set('');
    this.errorOperacion.set('');
  }

  // Los conflictos financieros pueden devolver un objeto con importes o el ID
  // del movimiento repetido; se conserva el mensaje del backend sin exponer datos sensibles.
  private mensajeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error) {
      const detail = (error.error as { detail?: unknown }).detail;
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        const detalle = detail as ApiDetailObject;
        if (typeof detalle.mensaje === 'string') {
          if (detalle.disponible && detalle.solicitado) {
            return `${detalle.mensaje}. Disponible: Q ${detalle.disponible}; solicitado: Q ${detalle.solicitado}.`;
          }
          if (detalle.id_movimiento) {
            return `${detalle.mensaje} (movimiento #${detalle.id_movimiento}).`;
          }
          return detalle.mensaje;
        }
      }
    }
    return getApiErrorMessage(error, fallback);
  }
}
