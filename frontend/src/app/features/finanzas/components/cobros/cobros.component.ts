import { CurrencyPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import { AuthService } from '../../../auth/services/auth.service';
import { Cliente } from '../../../clientes/models/cliente.models';
import { ClientesService } from '../../../clientes/services/clientes.service';
import {
  CobroSaldo,
  ComprobanteResumen,
  ComprobanteTicket,
  CotizacionInstalacionCobro,
  CotizacionOrdenCobro,
  MetodoPagoCobro,
  OrigenFinanciero,
  PagoConfirmado,
  PagoSaldoDisponible,
  RegistroPagoCreate,
  ServicioInternetCobro,
  TipoPagoOrden,
} from '../../models/cobros.models';
import { CobrosService } from '../../services/cobros.service';

type CategoriaCobro = OrigenFinanciero;
type EstadoCobro = 'PENDIENTE' | 'VENCIDO' | 'PAGADO';
type FiltroEstado = 'TODOS' | EstadoCobro;
type IdentidadObligacion = number | `periodo:${number}:${string}`;

// Relaciona cada origen financiero con su permiso hijo persistido.
const PAYMENT_MODULE_BY_CATEGORY: Record<CategoriaCobro, string> = {
  INTERNET: 'pagos_internet',
  INSTALACIONES: 'pagos_instalaciones',
  ORDENES_TRABAJO: 'pagos_ordenes_trabajo',
};

export interface CobroVista {
  tieneComprobante?: boolean;
  id: number;
  clienteId: number;
  servicioId: number | null;
  categoria: CategoriaCobro;
  cliente: string;
  telefonoCliente: string | null;
  codigo: string;
  comprobante: string | null;
  periodo: string | null;
  fecha: string;
  monto: number;
  vencimiento: string | null;
  estadoCobro: EstadoCobro;
  proforma: string | null;
  montoAutorizado: number;
  totalAbonado: number;
  saldoPendiente: number;
  tipoInstalacion: string | null;
}

interface ResumenCobro {
  estado: EstadoCobro;
  etiqueta: string;
  cantidad: number;
  total: number;
}

interface ClienteCobroVisual {
  id: number;
  nombre: string;
  codigo: string;
  telefono: string;
}

interface ObligacionCobroVisual {
  id: IdentidadObligacion;
  clienteId: number;
  categoria: CategoriaCobro;
  codigo: string;
  periodo: string | null;
  vencimiento: string | null;
  adelantado: boolean;
  proforma: string | null;
  concepto: string;
  monto: number;
  abonos: number;
  saldo: number;
  plan: string | null;
  estado: EstadoCobro;
  tipoInstalacion: string | null;
  proyectado: boolean;
}

@Component({
  selector: 'app-cobros',
  imports: [CurrencyPipe, DatePipe, NgTemplateOutlet, RouterLink],
  templateUrl: './cobros.component.html',
  styleUrls: [
    './cobros.component.css',
    './cobros-modal.component.css',
    './cobros-internet.component.css',
    './cobros-proyectos.component.css',
    './cobros-comprobante.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CobrosComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly cobrosService = inject(CobrosService);
  private readonly clientesService = inject(ClientesService);
  private readonly claveIdempotencia = signal<string | null>(null);
  private readonly empleadoIdAutenticado = signal<number | null>(
    this.auth.currentUser()?.empleado?.id_empleado ?? null,
  );
  private consultaAnticiposId = 0;

  readonly categorias: ReadonlyArray<{ valor: CategoriaCobro; etiqueta: string }> = [
    { valor: 'INTERNET', etiqueta: 'Internet' },
    { valor: 'INSTALACIONES', etiqueta: 'Instalaciones' },
    { valor: 'ORDENES_TRABAJO', etiqueta: 'Órdenes de trabajo' },
  ];
  readonly categoriasVisibles = computed(() =>
    this.categorias.filter((categoria) => this.categoriaAutorizada(categoria.valor)),
  );
  readonly puedeAdministrarVencimientos = computed(
    () => this.auth.isAdministrator() || this.auth.hasModule('administrar_vencimientos_internet'),
  );
  readonly puedeGenerarMensualidades = computed(
    () => this.auth.isAdministrator() || this.auth.hasModule('generar_mensualidades_internet'),
  );
  readonly estados: ReadonlyArray<{ valor: EstadoCobro; etiqueta: string }> = [
    { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
    { valor: 'VENCIDO', etiqueta: 'Vencido' },
    { valor: 'PAGADO', etiqueta: 'Pagado' },
  ];
  readonly tiposPagoOrden: ReadonlyArray<{ valor: TipoPagoOrden; etiqueta: string }> = [
    { valor: 'ANTICIPO', etiqueta: 'Anticipo' },
    { valor: 'PENDIENTE', etiqueta: 'Pago pendiente' },
    { valor: 'TOTAL', etiqueta: 'Pago total' },
  ];

  readonly cobros = signal<CobroVista[]>([]);
  readonly clientes = signal<ClienteCobroVisual[]>([]);
  readonly metodosPago = signal<MetodoPagoCobro[]>([]);
  readonly serviciosInternet = signal<ServicioInternetCobro[]>([]);
  readonly cargandoServiciosInternet = signal(false);
  readonly errorServiciosInternet = signal('');
  readonly asignacionVencimientoEdicionId = signal<number | null>(null);
  readonly diaVencimientoEdicion = signal('');
  readonly guardandoDiaVencimiento = signal(false);
  readonly errorDiaVencimiento = signal('');
  readonly modalVencimientosAbierto = signal(false);
  readonly busquedaVencimientos = signal('');
  readonly periodoGeneracion = signal(this.fechaLocalActual().slice(0, 7));
  readonly generandoMensualidades = signal(false);
  readonly mensajeGeneracion = signal('');
  readonly errorGeneracion = signal('');
  readonly anticipos = signal<PagoSaldoDisponible[]>([]);
  readonly cotizacionesOrden = signal<CotizacionOrdenCobro[]>([]);
  readonly cargandoCotizacionesOrden = signal(false);
  readonly errorCotizacionesOrden = signal('');
  readonly cotizacionOrdenSeleccionadaId = signal<number | null>(null);
  readonly cotizacionesInstalacion = signal<CotizacionInstalacionCobro[]>([]);
  readonly cargandoCotizacionesInstalacion = signal(false);
  readonly errorCotizacionesInstalacion = signal('');
  readonly cotizacionInstalacionSeleccionadaId = signal<number | null>(null);
  readonly cargando = signal(false);
  readonly cargandoAnticipos = signal(false);
  readonly guardandoPago = signal(false);
  readonly errorCarga = signal('');
  readonly errorPago = signal('');
  readonly requiereRecepcionFisica = computed(
    () =>
      this.categoriaRegistro() === 'INTERNET' &&
      !this.aplicandoAnticipo() &&
      !this.registrandoPendiente() &&
      this.normalizar(this.metodoSeleccionado()?.nombre ?? '') === 'efectivo',
  );
  // El efectivo de Internet se clasifica automáticamente como recibido por el
  // empleado autenticado. No requiere selector ni lista de receptores.
  readonly recepcionFisicaValida = computed(() => !this.requiereRecepcionFisica() || true);
  readonly categoriaActiva = signal<CategoriaCobro>('INTERNET');
  readonly busqueda = signal('');
  readonly filtroPeriodo = signal('');
  readonly filtroEstado = signal<FiltroEstado>('TODOS');
  readonly modalRegistroAbierto = signal(false);
  readonly busquedaCliente = signal('');
  readonly clienteSeleccionadoId = signal<number | null>(null);
  readonly categoriaRegistro = signal<CategoriaCobro>('INSTALACIONES');
  readonly obligacionesSeleccionadas = signal<ReadonlySet<IdentidadObligacion>>(
    new Set<IdentidadObligacion>(),
  );
  readonly metodoPago = signal<number | null>(null);
  readonly montoPago = signal(0);
  readonly tipoPagoOrden = signal<TipoPagoOrden>('TOTAL');
  readonly tipoPagoInstalacion = signal<TipoPagoOrden>('TOTAL');
  readonly fechaPago = signal('');
  readonly referenciaPago = signal('');
  readonly observacionesPago = signal('');
  readonly anticipoSeleccionadoId = signal<number | null>(null);
  readonly anticipoAplicado = signal(false);
  readonly comprobanteAbierto = signal(false);
  readonly confirmacionPagoAbierta = signal(false);
  readonly pagoConfirmado = signal<PagoConfirmado | null>(null);
  readonly anchoTicket = signal<'58' | '80'>('58');
  readonly descargandoComprobante = signal(false);
  readonly historialAbierto = signal(false);
  readonly historialCobro = signal<CobroVista | null>(null);
  readonly comprobantesHistorial = signal<ComprobanteResumen[]>([]);
  readonly cargandoHistorial = signal(false);
  readonly errorHistorial = signal('');
  readonly comprobanteOriginal = signal<ComprobanteResumen | null>(null);
  readonly ticketOriginal = signal<ComprobanteTicket | null>(null);

  readonly comprobanteActual = computed(() =>
    this.comprobanteOriginal()
      ? this.ticketOriginal()
      : (this.pagoConfirmado()?.comprobante ?? null),
  );
  // El descuento permanece oculto mientras no exista un valor real.
  readonly descuentoVisible = computed(() => Number(this.comprobanteActual()?.descuento ?? 0) > 0);
  readonly periodosComprobante = computed(() => this.comprobanteActual()?.periodos ?? []);
  readonly conceptosComprobante = computed(() =>
    [...(this.comprobanteActual()?.conceptos ?? [])].sort((a, b) =>
      (a.periodo ?? '9999-99').localeCompare(b.periodo ?? '9999-99'),
    ),
  );

  /** Formatea meses y conceptos solo en pantalla; la clave financiera no cambia. */
  nombrePeriodoComprobante(texto: string): string {
    return texto.replace(/\b(\d{4})-(0[1-9]|1[0-2])\b/g, (_, anio: string, mes: string) =>
      new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${anio}-${mes}-01T00:00:00Z`),
      ),
    );
  }

  ngOnDestroy(): void {
    this.cerrarComprobanteOriginal();
  }

  readonly cobrosCategoria = computed(() =>
    this.cobros().filter((cobro) => cobro.categoria === this.categoriaActiva()),
  );

  readonly resumen = computed<ResumenCobro[]>(() =>
    this.estados.map(({ valor, etiqueta }) => {
      const registros = this.cobrosCategoria().filter((cobro) => cobro.estadoCobro === valor);
      return {
        estado: valor,
        etiqueta,
        cantidad: registros.length,
        total: registros.reduce((total, cobro) => total + this.importeResumen(cobro), 0),
      };
    }),
  );

  readonly cobrosFiltrados = computed(() => {
    const termino = this.normalizar(this.busqueda());
    const periodo = this.filtroPeriodo();
    const estado = this.filtroEstado();
    return this.cobrosCategoria().filter((cobro) => {
      const texto = `${cobro.cliente} ${cobro.codigo} ${cobro.comprobante ?? ''}`;
      const fechaFiltro = cobro.periodo ?? cobro.fecha;
      return (
        (!termino || this.normalizar(texto).includes(termino)) &&
        (!periodo || fechaFiltro.startsWith(periodo)) &&
        (estado === 'TODOS' || cobro.estadoCobro === estado)
      );
    });
  });

  readonly serviciosInternetFiltrados = computed(() => {
    const termino = this.normalizar(this.busquedaVencimientos());
    return this.serviciosInternet().filter((servicio) => {
      const texto = `${servicio.cliente.nombres} ${servicio.cliente.apellidos} ${servicio.plan.nombre}`;
      return !termino || this.normalizar(texto).includes(termino);
    });
  });

  readonly diaVencimientoValido = computed(() => {
    const texto = this.diaVencimientoEdicion().trim();
    const dia = Number(texto);
    return texto !== '' && Number.isInteger(dia) && dia >= 1 && dia <= 31;
  });
  readonly periodoGeneracionValido = computed(() =>
    /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(this.periodoGeneracion()),
  );

  readonly clientesVisuales = computed(() => this.clientes());

  readonly clientesFiltrados = computed(() => {
    const termino = this.normalizar(this.busquedaCliente());
    return this.clientesVisuales().filter((cliente) =>
      this.normalizar(`${cliente.nombre} ${cliente.codigo} ${cliente.telefono}`).includes(termino),
    );
  });

  readonly clienteRegistro = computed(
    () =>
      this.clientesVisuales().find((cliente) => cliente.id === this.clienteSeleccionadoId()) ??
      null,
  );

  readonly obligaciones = computed<ObligacionCobroVisual[]>(() =>
    this.cobros().map((cobro) => ({
      id: cobro.id,
      clienteId: cobro.clienteId,
      categoria: cobro.categoria,
      codigo: cobro.codigo,
      periodo: cobro.periodo,
      vencimiento: cobro.vencimiento,
      adelantado: false,
      proforma: cobro.proforma,
      concepto: cobro.comprobante ? `Cotización ${cobro.comprobante}` : `Cobro #${cobro.id}`,
      monto: cobro.montoAutorizado,
      abonos: cobro.totalAbonado,
      saldo: cobro.saldoPendiente,
      plan: this.servicioInternetDeCobro(cobro)?.plan.nombre ?? null,
      estado: cobro.estadoCobro,
      tipoInstalacion: cobro.tipoInstalacion,
      proyectado: false,
    })),
  );

  readonly obligacionesRegistro = computed(() => {
    const clienteId = this.clienteSeleccionadoId();
    return this.obligaciones().filter(
      (obligacion) =>
        obligacion.clienteId === clienteId && obligacion.categoria === this.categoriaRegistro(),
    );
  });
  readonly mensualidadesInternet = computed(() => {
    const periodoActual = this.fechaLocalActual().slice(0, 7);
    // El período actual no es un pago adelantado: si aún no existe en cobros,
    // se muestra junto a las mensualidades para diferenciarlo de los futuros.
    const actualProyectado = this.periodosInternetProyectados().filter(
      (periodo) => periodo.periodo === periodoActual,
    );
    return [
      ...this.obligacionesRegistro().filter(
        (obligacion) => obligacion.periodo === null || obligacion.periodo <= periodoActual,
      ),
      ...actualProyectado,
    ].sort((a, b) => (a.periodo ?? '').localeCompare(b.periodo ?? ''));
  });
  readonly periodosInternetProyectados = computed<ObligacionCobroVisual[]>(() => {
    const clienteId = this.clienteSeleccionadoId();
    if (clienteId === null || this.categoriaRegistro() !== 'INTERNET') return [];
    const periodoActual = this.fechaLocalActual().slice(0, 7);
    return this.serviciosInternet()
      .filter(
        (servicio) =>
          servicio.id_cliente === clienteId &&
          servicio.estado === 'Activo' &&
          servicio.dia_vencimiento !== null,
      )
      .flatMap((servicio) => {
        const inicio = new Date(`${servicio.fecha_inicio.slice(0, 10)}T00:00:00`);
        const despuesMesGratis = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 1);
        const [anioActual, mesActual] = periodoActual.split('-').map(Number);
        const actual = new Date(anioActual, mesActual - 1, 1);
        const primerPeriodo = despuesMesGratis > actual ? despuesMesGratis : actual;
        const persistidos = new Set(
          this.obligaciones()
            .filter(
              (obligacion) =>
                obligacion.categoria === 'INTERNET' &&
                obligacion.clienteId === clienteId &&
                obligacion.periodo !== null &&
                this.cobros().some(
                  (cobro) =>
                    cobro.id === obligacion.id && cobro.servicioId === servicio.id_asignacion,
                ),
            )
            .map((obligacion) => obligacion.periodo),
        );
        return Array.from({ length: 12 }, (_, indice) => {
          const fecha = new Date(primerPeriodo.getFullYear(), primerPeriodo.getMonth() + indice, 1);
          const periodo = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
          const ultimoDia = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
          const dia = Math.min(servicio.dia_vencimiento!, ultimoDia);
          return {
            id: `periodo:${servicio.id_asignacion}:${periodo}` as const,
            clienteId,
            categoria: 'INTERNET' as const,
            codigo: `#${servicio.id_asignacion}`,
            periodo,
            vencimiento: `${periodo}-${String(dia).padStart(2, '0')}`,
            adelantado: periodo > periodoActual,
            proforma: null,
            concepto: `${servicio.plan.nombre} · ${periodo}`,
            monto: Number(servicio.costo_mensual),
            abonos: 0,
            saldo: Number(servicio.costo_mensual),
            plan: servicio.plan.nombre,
            estado: 'PENDIENTE' as const,
            tipoInstalacion: null,
            proyectado: true,
          };
        }).filter((obligacion) => !persistidos.has(obligacion.periodo));
      });
  });
  readonly pagosAdelantadosInternet = computed<ObligacionCobroVisual[]>(() => {
    const periodoActual = this.fechaLocalActual().slice(0, 7);
    const persistidosFuturos = this.obligacionesRegistro().filter(
      (obligacion) => obligacion.periodo !== null && obligacion.periodo > periodoActual,
    );
    return [
      ...persistidosFuturos,
      ...this.periodosInternetProyectados().filter(
        (obligacion) => obligacion.periodo !== null && obligacion.periodo > periodoActual,
      ),
    ].sort((a, b) => (a.periodo ?? '').localeCompare(b.periodo ?? ''));
  });
  readonly obligacionesInternetDisponibles = computed(() => [
    ...this.mensualidadesInternet(),
    ...this.pagosAdelantadosInternet(),
  ]);
  readonly tienePeriodosProyectadosSeleccionados = computed(() =>
    this.periodosInternetProyectados().some((periodo) =>
      this.obligacionesSeleccionadas().has(periodo.id),
    ),
  );
  readonly cotizacionOrdenSeleccionada = computed(
    () =>
      this.cotizacionesOrden().find(
        (cotizacion) => cotizacion.id_cotizacion === this.cotizacionOrdenSeleccionadaId(),
      ) ?? null,
  );
  readonly cotizacionInstalacionSeleccionada = computed(
    () =>
      this.cotizacionesInstalacion().find(
        (cotizacion) => cotizacion.id_cotizacion === this.cotizacionInstalacionSeleccionadaId(),
      ) ?? null,
  );
  readonly totalSeleccionado = computed(() => {
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      return Number(this.cotizacionOrdenSeleccionada()?.saldo_pendiente ?? 0);
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      return Number(this.cotizacionInstalacionSeleccionada()?.saldo_pendiente ?? 0);
    }
    const seleccionadas = this.obligacionesSeleccionadas();
    const obligaciones =
      this.categoriaRegistro() === 'INTERNET'
        ? this.obligacionesInternetDisponibles()
        : this.obligaciones();
    return obligaciones
      .filter((obligacion) => seleccionadas.has(obligacion.id))
      .reduce((total, obligacion) => total + obligacion.saldo, 0);
  });
  readonly saldoRestante = computed(() => Math.max(this.totalSeleccionado() - this.montoPago(), 0));
  readonly cantidadSeleccionada = computed(() => {
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      return this.cotizacionOrdenSeleccionadaId() === null ? 0 : 1;
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      return this.cotizacionInstalacionSeleccionadaId() === null ? 0 : 1;
    }
    return this.obligacionesSeleccionadas().size;
  });
  readonly metodoSeleccionado = computed(
    () => this.metodosPago().find((metodo) => metodo.id_metodo_pago === this.metodoPago()) ?? null,
  );
  readonly anticipoSeleccionado = computed(
    () =>
      this.anticipos().find((anticipo) => anticipo.id_pago === this.anticipoSeleccionadoId()) ??
      null,
  );
  readonly aplicandoAnticipo = computed(() => this.anticipoSeleccionado() !== null);
  readonly requiereReferencia = computed(
    () => this.normalizar(this.metodoSeleccionado()?.nombre ?? '') !== 'efectivo',
  );
  // PENDIENTE conserva la deuda con Q0.00; no utiliza un anticipo ni un método de pago.
  readonly registrandoPendiente = computed(
    () =>
      !this.aplicandoAnticipo() &&
      ((this.categoriaRegistro() === 'ORDENES_TRABAJO' && this.tipoPagoOrden() === 'PENDIENTE') ||
        (this.categoriaRegistro() === 'INSTALACIONES' &&
          this.tipoPagoInstalacion() === 'PENDIENTE')),
  );
  readonly pagoVisualValido = computed(() => {
    if (!this.recepcionFisicaValida()) return false;
    if (this.registrandoPendiente()) {
      const cotizacion =
        this.categoriaRegistro() === 'ORDENES_TRABAJO'
          ? this.cotizacionOrdenSeleccionada()
          : this.cotizacionInstalacionSeleccionada();
      return (
        this.clienteSeleccionadoId() !== null &&
        cotizacion !== null &&
        Number(cotizacion.saldo_pendiente) > 0 &&
        this.montoPago() === 0 &&
        !this.guardandoPago()
      );
    }
    const datosComunesValidos =
      this.clienteSeleccionadoId() !== null && this.montoPago() > 0 && !this.guardandoPago();
    if (this.categoriaRegistro() === 'INTERNET') {
      return (
        datosComunesValidos &&
        this.obligacionesSeleccionadas().size > 0 &&
        (this.tienePeriodosProyectadosSeleccionados()
          ? this.redondearMoneda(this.montoPago()) ===
            this.redondearMoneda(this.totalSeleccionado())
          : this.redondearMoneda(this.montoPago()) <=
            this.redondearMoneda(this.totalSeleccionado())) &&
        this.metodoSeleccionado() !== null &&
        (!this.requiereReferencia() || Boolean(this.referenciaPago().trim()))
      );
    }
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      const monto = this.redondearMoneda(this.montoPago());
      const saldo = this.redondearMoneda(this.totalSeleccionado());
      const tipoPagoValido =
        monto <= saldo && (this.tipoPagoOrden() === 'TOTAL' ? monto === saldo : monto < saldo);
      return (
        datosComunesValidos &&
        this.cotizacionOrdenSeleccionada() !== null &&
        (this.aplicandoAnticipo() || tipoPagoValido) &&
        (this.aplicandoAnticipo()
          ? this.cotizacionOrdenSeleccionada()?.id_cobro != null
          : this.metodoSeleccionado() !== null &&
            (!this.requiereReferencia() || Boolean(this.referenciaPago().trim())))
      );
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      const monto = this.redondearMoneda(this.montoPago());
      const saldo = this.redondearMoneda(this.totalSeleccionado());
      const tipoPagoValido =
        monto <= saldo &&
        (this.tipoPagoInstalacion() === 'TOTAL' ? monto === saldo : monto < saldo);
      return (
        datosComunesValidos &&
        this.cotizacionInstalacionSeleccionada() !== null &&
        (this.aplicandoAnticipo() || tipoPagoValido) &&
        (this.aplicandoAnticipo()
          ? this.cotizacionInstalacionSeleccionada()?.id_cobro != null
          : this.metodoSeleccionado() !== null &&
            (!this.requiereReferencia() || Boolean(this.referenciaPago().trim())))
      );
    }
    if (this.aplicandoAnticipo()) {
      return datosComunesValidos && this.obligacionesSeleccionadas().size > 0;
    }
    return (
      datosComunesValidos &&
      this.metodoSeleccionado() !== null &&
      (!this.requiereReferencia() || Boolean(this.referenciaPago().trim()))
    );
  });
  readonly mensajeValidacionPago = computed(() => {
    if (!this.recepcionFisicaValida())
      return 'Indique dónde se recibió el efectivo y seleccione al cobrador físico real.';
    if (this.registrandoPendiente()) {
      if (this.clienteSeleccionadoId() === null)
        return 'Seleccione un cliente para registrar la obligación pendiente.';
      if (this.cantidadSeleccionada() === 0)
        return 'Seleccione una cotización con proforma y saldo pendiente.';
      return (
        this.errorPago() || this.errorCotizacionesOrden() || this.errorCotizacionesInstalacion()
      );
    }
    if (this.categoriaRegistro() === 'INTERNET') {
      if (this.clienteSeleccionadoId() === null) {
        return 'Seleccione un cliente para registrar el pago.';
      }
      if (this.obligacionesSeleccionadas().size === 0) {
        return 'Seleccione al menos una mensualidad pendiente.';
      }
      if (this.montoPago() <= 0) return 'Ingrese un monto recibido mayor que cero.';
      if (this.montoPago() > this.totalSeleccionado()) {
        return 'El monto recibido no puede superar el saldo seleccionado.';
      }
      if (
        this.tienePeriodosProyectadosSeleccionados() &&
        this.redondearMoneda(this.montoPago()) !== this.redondearMoneda(this.totalSeleccionado())
      ) {
        return 'Los períodos proyectados requieren el pago completo de toda la selección.';
      }
      if (!this.metodoSeleccionado()) return 'Seleccione un método de pago.';
      if (this.requiereReferencia() && !this.referenciaPago().trim()) {
        return 'Ingrese la referencia bancaria para continuar.';
      }
      return this.errorPago();
    }
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      if (this.clienteSeleccionadoId() === null) {
        return 'Seleccione un cliente para registrar el pago.';
      }
      if (this.cotizacionOrdenSeleccionada() === null) {
        return 'Seleccione una cotización con proforma y saldo pendiente.';
      }
      if (this.aplicandoAnticipo() && this.cotizacionOrdenSeleccionada()?.id_cobro == null) {
        return 'El anticipo requiere que la orden ya tenga una obligación registrada.';
      }
      if (this.montoPago() <= 0) {
        return 'Ingrese un monto recibido mayor que cero.';
      }
      if (!this.aplicandoAnticipo()) {
        const monto = this.redondearMoneda(this.montoPago());
        const saldo = this.redondearMoneda(this.totalSeleccionado());
        if (monto > saldo) return 'El monto recibido no puede superar el saldo de la orden.';
        if (this.tipoPagoOrden() === 'TOTAL' && monto !== saldo) {
          return 'El pago total debe cancelar exactamente el saldo de la orden.';
        }
        if (this.tipoPagoOrden() !== 'TOTAL' && monto >= saldo) {
          return 'El anticipo debe ser menor que el saldo de la orden.';
        }
      }
      if (!this.aplicandoAnticipo() && !this.metodoSeleccionado()) {
        return 'Seleccione un método de pago.';
      }
      if (!this.aplicandoAnticipo() && this.requiereReferencia() && !this.referenciaPago().trim()) {
        return 'Ingrese la referencia bancaria para continuar.';
      }
      return this.errorPago() || this.errorCotizacionesOrden();
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      if (this.clienteSeleccionadoId() === null) {
        return 'Seleccione un cliente para registrar el pago.';
      }
      if (this.cotizacionInstalacionSeleccionada() === null) {
        return 'Seleccione una cotización de instalación con proforma y saldo pendiente.';
      }
      if (this.aplicandoAnticipo() && this.cotizacionInstalacionSeleccionada()?.id_cobro == null) {
        return 'El anticipo requiere que la instalación ya tenga una obligación registrada.';
      }
      if (this.montoPago() <= 0) {
        return 'Ingrese un monto recibido mayor que cero.';
      }
      if (!this.aplicandoAnticipo()) {
        const monto = this.redondearMoneda(this.montoPago());
        const saldo = this.redondearMoneda(this.totalSeleccionado());
        if (monto > saldo) {
          return 'El monto recibido no puede superar el saldo de la instalación.';
        }
        if (this.tipoPagoInstalacion() === 'TOTAL' && monto !== saldo) {
          return 'El pago total debe cancelar exactamente el saldo de la instalación.';
        }
        if (this.tipoPagoInstalacion() !== 'TOTAL' && monto >= saldo) {
          return 'El anticipo debe ser menor que el saldo de la instalación.';
        }
      }
      if (!this.aplicandoAnticipo() && !this.metodoSeleccionado()) {
        return 'Seleccione un método de pago.';
      }
      if (!this.aplicandoAnticipo() && this.requiereReferencia() && !this.referenciaPago().trim()) {
        return 'Ingrese la referencia bancaria para continuar.';
      }
      return this.errorPago() || this.errorCotizacionesInstalacion();
    }
    return 'Los pagos solo están habilitados para obligaciones verificables de instalaciones.';
  });
  readonly obligacionesComprobante = computed(() => {
    const pago = this.pagoConfirmado();
    if (!pago) return [];
    return pago.detalles.map((detalle) => {
      const obligacion = this.obligaciones().find((item) => item.id === detalle.id_cobro);
      return {
        ...(obligacion ?? {
          id: detalle.id_cobro,
          clienteId: detalle.id_cliente,
          categoria: detalle.origen_financiero,
          codigo: `Cobro #${detalle.id_cobro}`,
          periodo: null,
          vencimiento: null,
          adelantado: false,
          proforma: null,
          concepto: detalle.concepto ?? `Cobro #${detalle.id_cobro}`,
          monto: Number(detalle.monto_aplicado),
          abonos: 0,
          plan: null,
          estado: 'PENDIENTE' as EstadoCobro,
          tipoInstalacion: null,
          proyectado: false,
        }),
        saldo: Number(detalle.monto_aplicado),
      };
    });
  });
  readonly categoriaRegistroEtiqueta = computed(
    () => this.categorias.find((item) => item.valor === this.categoriaRegistro())?.etiqueta ?? '',
  );
  readonly metodoPagoEtiqueta = computed(
    () => this.anticipoSeleccionado()?.metodo_pago ?? this.metodoSeleccionado()?.nombre ?? '—',
  );
  readonly montoNoAplicado = computed(() => Number(this.pagoConfirmado()?.monto_no_aplicado ?? 0));

  ngOnInit(): void {
    this.ajustarCategoriasIniciales();
    if (this.categorias.some((categoria) => this.puedeRegistrarPagos(categoria.valor))) {
      this.cargarDatos();
    }
    if (this.categoriaAutorizada('INTERNET')) this.cargarServiciosInternet();
    this.restaurarAnchoTicket();
  }

  cargarDatos(): void {
    this.cargando.set(true);
    this.errorCarga.set('');
    // Los clientes se cargan por separado para que un fallo en Cobros no deje
    // vacio el selector del registro de pagos.
    this.cargarClientes();
    forkJoin({
      cobros: this.cobrosService.listarTodos(),
      metodos: this.cobrosService.listarMetodosPago(),
    })
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: ({ cobros, metodos }) => {
          this.cobros.set(cobros.map((cobro) => this.adaptarCobro(cobro)));
          this.metodosPago.set(metodos.filter((metodo) => metodo.estado === 'Activo'));
        },
        error: (error: unknown) =>
          this.errorCarga.set(getApiErrorMessage(error, 'No fue posible consultar los cobros.')),
      });
  }

  private cargarClientes(): void {
    // Si el usuario tiene Pagos pero no Clientes, Cobros expone los clientes
    // activos con su propio permiso reutilizando el servicio de Clientes.
    this.clientesService
      .getAll()
      .pipe(catchError(() => this.cobrosService.listarClientesActivos()))
      .subscribe({
        next: (clientes) => this.clientes.set(this.adaptarClientes(clientes)),
        error: (error: unknown) =>
          this.errorCarga.set(getApiErrorMessage(error, 'No fue posible consultar los clientes.')),
      });
  }

  private cargarServiciosInternet(): void {
    this.cargandoServiciosInternet.set(true);
    this.errorServiciosInternet.set('');
    this.cobrosService
      .listarServiciosInternet()
      .pipe(finalize(() => this.cargandoServiciosInternet.set(false)))
      .subscribe({
        next: (servicios) => this.serviciosInternet.set(servicios),
        error: (error: unknown) =>
          this.errorServiciosInternet.set(
            getApiErrorMessage(error, 'No fue posible consultar los servicios de Internet.'),
          ),
      });
  }

  seleccionarCategoria(categoria: CategoriaCobro): void {
    if (!this.categoriaAutorizada(categoria)) return;
    this.categoriaActiva.set(categoria);
    this.filtroPeriodo.set('');
    this.filtroEstado.set('TODOS');
  }

  iniciarEdicionDiaVencimiento(servicio: ServicioInternetCobro): void {
    if (!this.puedeAdministrarVencimientos() || this.guardandoDiaVencimiento()) return;
    this.asignacionVencimientoEdicionId.set(servicio.id_asignacion);
    this.diaVencimientoEdicion.set(
      servicio.dia_vencimiento === null ? '' : String(servicio.dia_vencimiento),
    );
    this.errorDiaVencimiento.set('');
  }

  actualizarDiaVencimientoEdicion(event: Event): void {
    this.diaVencimientoEdicion.set((event.target as HTMLInputElement).value);
    this.errorDiaVencimiento.set('');
  }

  cancelarEdicionDiaVencimiento(): void {
    if (this.guardandoDiaVencimiento()) return;
    this.asignacionVencimientoEdicionId.set(null);
    this.diaVencimientoEdicion.set('');
    this.errorDiaVencimiento.set('');
  }

  guardarDiaVencimiento(generarDespues = false): void {
    if (!this.puedeAdministrarVencimientos()) return;
    const idAsignacion = this.asignacionVencimientoEdicionId();
    if (idAsignacion === null || !this.diaVencimientoValido()) {
      this.errorDiaVencimiento.set('Ingrese un día entero entre 1 y 31.');
      return;
    }
    const diaVencimiento = Number(this.diaVencimientoEdicion());
    this.guardandoDiaVencimiento.set(true);
    this.errorDiaVencimiento.set('');
    this.cobrosService
      .actualizarDiaVencimiento(idAsignacion, { dia_vencimiento: diaVencimiento })
      .pipe(finalize(() => this.guardandoDiaVencimiento.set(false)))
      .subscribe({
        next: (actualizado) => {
          this.serviciosInternet.update((servicios) =>
            servicios.map((servicio) =>
              servicio.id_asignacion === actualizado.id_asignacion ? actualizado : servicio,
            ),
          );
          this.asignacionVencimientoEdicionId.set(null);
          this.diaVencimientoEdicion.set('');
          if (generarDespues) this.generarMensualidades(true);
        },
        error: (error: unknown) => {
          const detalle = getApiErrorMessage(
            error,
            'No fue posible actualizar el día de vencimiento.',
          );
          this.errorDiaVencimiento.set(
            generarDespues ? `${detalle} No se generaron mensualidades.` : detalle,
          );
        },
      });
  }

  actualizarPeriodoGeneracion(event: Event): void {
    this.periodoGeneracion.set((event.target as HTMLInputElement).value);
    this.mensajeGeneracion.set('');
    this.errorGeneracion.set('');
  }

  generarMensualidades(vencimientoGuardado = false): void {
    if (!this.puedeGenerarMensualidades()) return;
    if (!this.periodoGeneracionValido() || this.generandoMensualidades()) {
      this.errorGeneracion.set('Seleccione un mes y año válidos.');
      return;
    }
    const [anio, mes] = this.periodoGeneracion().split('-').map(Number);
    this.generandoMensualidades.set(true);
    this.mensajeGeneracion.set(
      vencimientoGuardado ? 'El día de vencimiento se guardó correctamente.' : '',
    );
    this.errorGeneracion.set('');
    this.cobrosService.generarMensualidadesInternet({ mes, anio }).subscribe({
      next: (resultado) => {
        const generadas =
          resultado.generadas === 1 ? 'mensualidad generada' : 'mensualidades generadas';
        const existentes = resultado.existentes === 1 ? 'ya existente' : 'ya existentes';
        const elegibles =
          resultado.total_elegibles === 1 ? 'servicio elegible' : 'servicios elegibles';
        this.mensajeGeneracion.set(
          `${vencimientoGuardado ? 'Día de vencimiento guardado. ' : ''}${resultado.generadas} ${generadas} y ${resultado.existentes} ${existentes}, de ${resultado.total_elegibles} ${elegibles}.`,
        );
        this.filtroPeriodo.set(resultado.periodo);
        if (!this.puedeRegistrarPagos('INTERNET')) {
          this.generandoMensualidades.set(false);
          return;
        }
        this.cobrosService.listarTodos().subscribe({
          next: (cobros) => {
            this.cobros.set(cobros.map((item) => this.adaptarCobro(item)));
            this.generandoMensualidades.set(false);
          },
          error: (error: unknown) => {
            this.errorGeneracion.set(
              getApiErrorMessage(
                error,
                'Las mensualidades se generaron, pero no fue posible actualizar el listado.',
              ),
            );
            this.generandoMensualidades.set(false);
          },
        });
      },
      error: (error: unknown) => {
        const detalle = getApiErrorMessage(error, 'No fue posible generar las mensualidades.');
        this.errorGeneracion.set(
          vencimientoGuardado
            ? `${detalle} El día de vencimiento sí se guardó, pero las mensualidades no se generaron.`
            : detalle,
        );
        this.generandoMensualidades.set(false);
      },
    });
  }

  guardarYGenerarMensualidades(): void {
    if (!this.puedeGenerarMensualidades()) return;
    if (this.guardandoDiaVencimiento() || this.generandoMensualidades()) return;
    if (this.asignacionVencimientoEdicionId() === null) {
      this.generarMensualidades();
      return;
    }
    if (!this.puedeAdministrarVencimientos()) return;
    if (!this.periodoGeneracionValido()) {
      this.errorGeneracion.set('Seleccione un mes y año válidos. No se guardó ni se generó nada.');
      return;
    }
    if (!this.diaVencimientoValido()) {
      this.errorDiaVencimiento.set(
        'No se guardó el día de vencimiento. Ingrese un entero entre 1 y 31. No se generaron mensualidades.',
      );
      return;
    }
    // La generación empieza únicamente después de confirmar el vencimiento pendiente.
    this.guardarDiaVencimiento(true);
  }

  abrirModalVencimientos(): void {
    if (!this.puedeAdministrarVencimientos() && !this.puedeGenerarMensualidades()) return;
    this.busquedaVencimientos.set('');
    this.errorDiaVencimiento.set('');
    this.mensajeGeneracion.set('');
    this.errorGeneracion.set('');
    this.modalVencimientosAbierto.set(true);
  }

  cerrarModalVencimientos(): void {
    if (this.guardandoDiaVencimiento() || this.generandoMensualidades()) return;
    this.cancelarEdicionDiaVencimiento();
    this.modalVencimientosAbierto.set(false);
  }

  actualizarBusquedaVencimientos(event: Event): void {
    this.busquedaVencimientos.set((event.target as HTMLInputElement).value);
  }

  proximoVencimiento(servicio: ServicioInternetCobro): string | null {
    if (servicio.dia_vencimiento === null) return null;
    const hoy = new Date();
    let anio = hoy.getFullYear();
    let mes = hoy.getMonth();
    const crearFecha = () =>
      new Date(
        anio,
        mes,
        Math.min(servicio.dia_vencimiento!, new Date(anio, mes + 1, 0).getDate()),
      );
    let vencimiento = crearFecha();
    if (vencimiento < new Date(anio, mes, hoy.getDate())) {
      mes += 1;
      if (mes === 12) {
        mes = 0;
        anio += 1;
      }
      vencimiento = crearFecha();
    }
    return `${vencimiento.getFullYear()}-${String(vencimiento.getMonth() + 1).padStart(2, '0')}-${String(
      vencimiento.getDate(),
    ).padStart(2, '0')}`;
  }

  servicioInternetDeCobro(cobro: CobroVista): ServicioInternetCobro | null {
    if (cobro.servicioId === null) return null;
    return (
      this.serviciosInternet().find((servicio) => servicio.id_asignacion === cobro.servicioId) ??
      null
    );
  }

  abrirRegistroCobro(cobro?: CobroVista): void {
    const categoria = cobro?.categoria ?? this.categoriaActiva();
    if (!this.puedeRegistrarPagos(categoria)) return;
    // Solo Internet controla custodia por empleado; los otros orígenes conservan su flujo propio.
    // El efectivo de Internet se clasifica automáticamente como recibido por el
    // empleado asociado al usuario autenticado. Cualquier usuario con permiso
    // para cobrar Internet puede registrarlo, independientemente de su rol.
    // Internet no requiere selector de custodia: se asigna automáticamente al
    // empleado del usuario autenticado.
    const cliente = cobro
      ? this.clientesVisuales().find((item) => item.id === cobro.clienteId)
      : (this.clientesVisuales().find((item) =>
          this.obligaciones().some(
            (obligacion) => obligacion.clienteId === item.id && obligacion.categoria === categoria,
          ),
        ) ?? this.clientesVisuales()[0]);
    this.clienteSeleccionadoId.set(cliente?.id ?? null);
    this.categoriaRegistro.set(categoria);
    this.busquedaCliente.set('');
    this.obligacionesSeleccionadas.set(
      cobro && cobro.estadoCobro !== 'PAGADO' ? new Set([cobro.id]) : new Set(),
    );
    const efectivo = this.metodosPago().find(
      (metodo) => this.normalizar(metodo.nombre) === 'efectivo',
    );
    this.metodoPago.set(efectivo?.id_metodo_pago ?? this.metodosPago()[0]?.id_metodo_pago ?? null);
    this.montoPago.set(cobro?.saldoPendiente ?? 0);
    this.fechaPago.set(this.fechaLocalActual());
    this.referenciaPago.set('');
    this.observacionesPago.set('');
    this.errorPago.set('');
    this.pagoConfirmado.set(null);
    this.claveIdempotencia.set(null);
    this.anticipoSeleccionadoId.set(null);
    this.anticipoAplicado.set(false);
    this.anticipos.set([]);
    this.cotizacionesOrden.set([]);
    this.cotizacionOrdenSeleccionadaId.set(null);
    this.errorCotizacionesOrden.set('');
    this.cotizacionesInstalacion.set([]);
    this.cotizacionInstalacionSeleccionadaId.set(null);
    this.errorCotizacionesInstalacion.set('');
    this.tipoPagoOrden.set('TOTAL');
    this.tipoPagoInstalacion.set('TOTAL');
    this.comprobanteAbierto.set(false);
    this.modalRegistroAbierto.set(true);
    if (cliente) {
      this.cargarAnticipos(cliente.id, categoria);
      if (categoria === 'ORDENES_TRABAJO') this.cargarCotizacionesOrden(cliente.id);
      if (categoria === 'INSTALACIONES') {
        this.cargarCotizacionesInstalacion(cliente.id, cobro?.id);
      }
    }
  }

  cerrarRegistroCobro(): void {
    if (this.guardandoPago()) return;
    this.comprobanteAbierto.set(false);
    this.modalRegistroAbierto.set(false);
  }

  actualizarBusquedaCliente(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLInputElement) this.busquedaCliente.set(control.value);
  }

  seleccionarCliente(clienteId: number): void {
    this.clienteSeleccionadoId.set(clienteId);
    this.limpiarSeleccionPago();
    this.cargarAnticipos(clienteId, this.categoriaRegistro());
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      this.cargarCotizacionesOrden(clienteId);
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      this.cargarCotizacionesInstalacion(clienteId);
    }
  }

  seleccionarCategoriaRegistro(categoria: CategoriaCobro): void {
    if (!this.categoriaAutorizada(categoria)) return;
    this.categoriaRegistro.set(categoria);
    this.limpiarSeleccionPago();
    const clienteId = this.clienteSeleccionadoId();
    if (clienteId !== null) {
      this.cargarAnticipos(clienteId, categoria);
      if (categoria === 'ORDENES_TRABAJO') {
        this.cargarCotizacionesOrden(clienteId);
      }
      if (categoria === 'INSTALACIONES') {
        this.cargarCotizacionesInstalacion(clienteId);
      }
    }
  }

  alternarObligacion(obligacionId: IdentidadObligacion): void {
    const disponibles =
      this.categoriaRegistro() === 'INTERNET'
        ? this.obligacionesInternetDisponibles()
        : this.obligaciones();
    const obligacion = disponibles.find((item) => item.id === obligacionId);
    if (!obligacion || obligacion.estado === 'PAGADO') return;
    const seleccionadas = new Set(this.obligacionesSeleccionadas());
    seleccionadas.has(obligacionId)
      ? seleccionadas.delete(obligacionId)
      : seleccionadas.add(obligacionId);
    this.obligacionesSeleccionadas.set(seleccionadas);
    this.montoPago.set(
      Math.min(
        disponibles
          .filter((item) => seleccionadas.has(item.id))
          .reduce((total, item) => total + item.saldo, 0),
        Number(this.anticipoSeleccionado()?.monto_no_aplicado ?? Number.POSITIVE_INFINITY),
      ),
    );
    this.reiniciarIntentoPago();
  }

  obligacionSeleccionada(obligacionId: IdentidadObligacion): boolean {
    return this.obligacionesSeleccionadas().has(obligacionId);
  }

  alternarCotizacionOrden(idCotizacion: number): void {
    const seleccionada = this.cotizacionOrdenSeleccionadaId();
    this.cotizacionOrdenSeleccionadaId.set(seleccionada === idCotizacion ? null : idCotizacion);
    const cotizacion = this.cotizacionOrdenSeleccionada();
    this.montoPago.set(
      this.registrandoPendiente() || cotizacion === null
        ? 0
        : Math.min(
            Number(cotizacion.saldo_pendiente),
            Number(this.anticipoSeleccionado()?.monto_no_aplicado ?? Number.POSITIVE_INFINITY),
          ),
    );
    this.reiniciarIntentoPago();
  }

  alternarCotizacionInstalacion(idCotizacion: number): void {
    const seleccionada = this.cotizacionInstalacionSeleccionadaId();
    this.cotizacionInstalacionSeleccionadaId.set(
      seleccionada === idCotizacion ? null : idCotizacion,
    );
    const cotizacion = this.cotizacionInstalacionSeleccionada();
    this.montoPago.set(
      this.registrandoPendiente() || cotizacion === null
        ? 0
        : Math.min(
            Number(cotizacion.saldo_pendiente),
            Number(this.anticipoSeleccionado()?.monto_no_aplicado ?? Number.POSITIVE_INFINITY),
          ),
    );
    this.reiniciarIntentoPago();
  }

  etiquetaEstadoInternet(estado: EstadoCobro | undefined): string {
    return this.estados.find((item) => item.valor === estado)?.etiqueta ?? 'Pendiente';
  }

  etiquetaEstadoProyecto(estado: EstadoCobro | undefined): string {
    return this.etiquetaEstadoInternet(estado);
  }

  actualizarMetodoPago(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLSelectElement) {
      this.metodoPago.set(Number(control.value));
      this.reiniciarIntentoPago();
    }
  }

  actualizarTipoPagoOrden(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLSelectElement) {
      const eraPendiente = this.registrandoPendiente();
      this.tipoPagoOrden.set(control.value as TipoPagoOrden);
      // Elegir pendiente descarta cualquier dinero/anticipo de la selección anterior.
      if (control.value === 'PENDIENTE') {
        this.anticipoSeleccionadoId.set(null);
        this.montoPago.set(0);
      } else if (eraPendiente) this.montoPago.set(this.totalSeleccionado());
      this.reiniciarIntentoPago();
    }
  }

  actualizarTipoPagoInstalacion(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLSelectElement) {
      const eraPendiente = this.registrandoPendiente();
      this.tipoPagoInstalacion.set(control.value as TipoPagoOrden);
      // La obligación de instalación sigue la misma regla de pendiente sin dinero.
      if (control.value === 'PENDIENTE') {
        this.anticipoSeleccionadoId.set(null);
        this.montoPago.set(0);
      } else if (eraPendiente) this.montoPago.set(this.totalSeleccionado());
      this.reiniciarIntentoPago();
    }
  }

  actualizarAnticipo(event: Event): void {
    if (this.registrandoPendiente()) return;
    const control = event.target;
    if (!(control instanceof HTMLSelectElement)) return;
    const idPago = Number(control.value) || null;
    this.anticipoSeleccionadoId.set(idPago);
    const anticipo = this.anticipoSeleccionado();
    if (anticipo) {
      this.metodoPago.set(anticipo.id_metodo_pago);
      this.montoPago.set(
        Math.min(
          Number(anticipo.monto_no_aplicado),
          this.totalSeleccionado() || Number(anticipo.monto_no_aplicado),
        ),
      );
    } else {
      this.montoPago.set(this.totalSeleccionado());
    }
    this.reiniciarIntentoPago();
  }

  actualizarMontoPago(event: Event): void {
    if (this.registrandoPendiente()) {
      this.montoPago.set(0);
      return;
    }
    const control = event.target;
    if (control instanceof HTMLInputElement) {
      this.montoPago.set(Number(control.value) || 0);
      this.reiniciarIntentoPago();
    }
  }

  actualizarReferenciaPago(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLInputElement) {
      this.referenciaPago.set(control.value);
      this.reiniciarIntentoPago();
    }
  }

  actualizarObservacionesPago(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLTextAreaElement) {
      this.observacionesPago.set(control.value);
      this.reiniciarIntentoPago();
    }
  }

  abrirComprobante(): void {
    if (!this.pagoVisualValido()) return;
    if (this.registrandoPendiente()) {
      this.registrarPendiente();
      return;
    }
    const payload = this.construirPago();
    if (this.requiereRecepcionFisica()) {
      // Cualquier usuario con permiso para cobrar Internet registra el efectivo
      // como recibido por el empleado asociado a su sesión autenticada.
      payload.recepcion_efectivo = 'EMPLEADO';
      payload.id_empleado_receptor = this.empleadoIdAutenticado() ?? undefined;
    }
    this.confirmacionPagoAbierta.set(false);
    this.guardandoPago.set(true);
    this.errorPago.set('');
    const anticipo = this.anticipoSeleccionado();
    const esOrden = this.categoriaRegistro() === 'ORDENES_TRABAJO';
    const esInstalacion = this.categoriaRegistro() === 'INSTALACIONES';
    const solicitud = anticipo
      ? this.cobrosService.distribuirPago(
          anticipo.id_pago,
          esOrden
            ? {
                aplicaciones: this.aplicacionesAnticipoOrden(),
                id_cotizacion: payload.id_cotizacion ?? null,
              }
            : esInstalacion
              ? {
                  aplicaciones: this.aplicacionesAnticipoInstalacion(),
                  id_cotizacion: payload.id_cotizacion ?? null,
                }
              : { aplicaciones: payload.aplicaciones },
        )
      : this.cobrosService.registrarPago(payload);
    solicitud.pipe(finalize(() => this.guardandoPago.set(false))).subscribe({
      next: (pago) => {
        this.anticipoAplicado.set(anticipo !== null);
        this.pagoConfirmado.set(pago);
        this.cobrosService.listarTodos().subscribe({
          next: (cobros) => this.cobros.set(cobros.map((item) => this.adaptarCobro(item))),
        });
        if (esOrden || esInstalacion) {
          // La proforma es el documento del proyecto; no se abre un ticket PDF.
          this.modalRegistroAbierto.set(false);
          this.comprobanteAbierto.set(false);
          const clienteId = this.clienteSeleccionadoId();
          if (esOrden && clienteId !== null) {
            this.cargarCotizacionesOrden(clienteId);
          }
          if (esInstalacion && clienteId !== null) {
            this.cargarCotizacionesInstalacion(clienteId);
          }
          return;
        }
        this.fechaPago.set(pago.fecha_hora.slice(0, 10));
        // La confirmación solo aparece tras la respuesta exitosa. El comprobante
        // ya fue emitido por FastAPI dentro de la transacción del pago.
        this.modalRegistroAbierto.set(false);
        this.comprobanteAbierto.set(false);
        this.confirmacionPagoAbierta.set(true);
      },
      error: (error: unknown) => {
        this.errorPago.set(
          getApiErrorMessage(
            error,
            anticipo ? 'No fue posible aplicar el anticipo.' : 'No fue posible registrar el pago.',
          ),
        );
      },
    });
  }

  cerrarComprobante(): void {
    this.comprobanteAbierto.set(false);
    this.modalRegistroAbierto.set(false);
  }

  /** Abre el ticket devuelto por el pago, sin volver a confirmar ni emitirlo. */
  mostrarComprobanteRegistrado(imprimir = false): void {
    if (!this.comprobanteActual()) return;
    this.confirmacionPagoAbierta.set(false);
    this.comprobanteAbierto.set(true);
    // Espera al renderizado del ticket de 58 mm antes de abrir la impresión.
    if (imprimir) window.setTimeout(() => this.imprimirTicket(), 0);
  }

  cerrarConfirmacionPago(): void {
    this.confirmacionPagoAbierta.set(false);
  }

  /** Registra únicamente deuda; mantiene separados los contratos de obligación y pago. */
  private registrarPendiente(): void {
    const origen = this.categoriaRegistro();
    const cliente = this.clienteSeleccionadoId();
    const cotizacion =
      origen === 'ORDENES_TRABAJO'
        ? this.cotizacionOrdenSeleccionada()
        : this.cotizacionInstalacionSeleccionada();
    if (
      (origen !== 'ORDENES_TRABAJO' && origen !== 'INSTALACIONES') ||
      cliente === null ||
      !cotizacion
    )
      return;
    this.guardandoPago.set(true);
    this.errorPago.set('');
    this.cobrosService
      .registrarPendiente({
        id_cliente: cliente,
        origen_financiero: origen,
        id_cotizacion: cotizacion.id_cotizacion,
        tipo_pago: 'PENDIENTE',
        monto_total: 0,
      })
      .pipe(finalize(() => this.guardandoPago.set(false)))
      .subscribe({
        next: () => {
          this.cobrosService.listarTodos().subscribe({
            next: (cobros) => this.cobros.set(cobros.map((item) => this.adaptarCobro(item))),
          });
          this.pagoConfirmado.set(null);
          this.comprobanteAbierto.set(false);
          this.modalRegistroAbierto.set(false);
        },
        error: (error: unknown) =>
          this.errorPago.set(
            getApiErrorMessage(error, 'No fue posible registrar la obligación pendiente.'),
          ),
      });
  }

  actualizarAnchoTicket(event: Event): void {
    const control = event.target;
    if (!(control instanceof HTMLSelectElement)) return;
    const ancho = control.value === '58' ? '58' : '80';
    this.anchoTicket.set(ancho);
    try {
      window.localStorage.setItem('sistemawisp:ticket-ancho', ancho);
    } catch {
      // El navegador puede bloquear almacenamiento; el ticket sigue funcionando.
    }
  }

  // Imprime exclusivamente el ticket y fija el ancho termico elegido mediante
  // una regla @page temporal, sin depender del ancho de la pantalla.
  imprimirTicket(): void {
    if (!this.comprobanteActual()) return;
    const ancho = '58';
    const estilo = document.createElement('style');
    estilo.id = 'thermal-ticket-page-size';
    estilo.textContent = `@media print { @page { size: ${ancho}mm auto; margin: 0; } }`;
    document.head.appendChild(estilo);
    document.body.classList.add('printing-payment-receipt');
    const limpiar = (): void => {
      document.body.classList.remove('printing-payment-receipt');
      estilo.remove();
      window.removeEventListener('afterprint', limpiar);
    };
    window.addEventListener('afterprint', limpiar, { once: true });
    try {
      window.print();
    } finally {
      // afterprint no se emite en todos los navegadores; el timeout limpia la regla.
      window.setTimeout(limpiar, 1500);
    }
  }

  descargarComprobanteActual(): void {
    const comprobante = this.comprobanteActual();
    if (!comprobante) return;
    this.descargarComprobante(comprobante.id_comprobante, comprobante.numero, (mensaje) =>
      this.errorPago.set(mensaje),
    );
  }

  abrirHistorialComprobantes(cobro: CobroVista, abrirUnico = false): void {
    this.historialCobro.set(cobro);
    this.historialAbierto.set(true);
    this.cargandoHistorial.set(true);
    this.errorHistorial.set('');
    this.comprobantesHistorial.set([]);
    this.cobrosService
      .listarComprobantes(cobro.id)
      .pipe(finalize(() => this.cargandoHistorial.set(false)))
      .subscribe({
        next: (pagina) => {
          this.comprobantesHistorial.set(pagina.items);
          // Con varios documentos se conserva el selector del historial.
          if (abrirUnico && pagina.total === 1 && pagina.items.length === 1) {
            this.verComprobanteOriginal(pagina.items[0]);
          }
        },
        error: (error: unknown) =>
          this.errorHistorial.set(
            getApiErrorMessage(error, 'No fue posible consultar los comprobantes.'),
          ),
      });
  }

  cerrarHistorialComprobantes(): void {
    this.historialAbierto.set(false);
    this.historialCobro.set(null);
    this.comprobantesHistorial.set([]);
    this.errorHistorial.set('');
  }

  descargarComprobanteHistorial(comprobante: ComprobanteResumen): void {
    this.descargarComprobante(comprobante.id_comprobante, comprobante.numero, (mensaje) =>
      this.errorHistorial.set(mensaje),
    );
  }

  /** Abre la vista de documento; los filtros de Cobros permanecen en sus señales. */
  verComprobanteOriginal(comprobante: ComprobanteResumen): void {
    if (this.descargandoComprobante()) return;
    this.cerrarComprobanteOriginal();
    this.comprobanteOriginal.set(comprobante);
    this.historialAbierto.set(false);
    this.comprobanteAbierto.set(false);
    this.errorHistorial.set('');
    this.descargandoComprobante.set(true);
    this.cobrosService
      .consultarComprobante(comprobante.id_comprobante)
      .pipe(finalize(() => this.descargandoComprobante.set(false)))
      .subscribe({
        next: (ticket) => {
          // No reabre un documento abandonado ni mezcla datos de otro pago.
          if (this.comprobanteOriginal() === comprobante) {
            this.ticketOriginal.set(ticket);
          }
        },
        error: () => {
          if (this.comprobanteOriginal() === comprobante) {
            this.errorHistorial.set(
              'No fue posible consultar el comprobante. No se emitió otro documento.',
            );
          }
        },
      });
  }

  cerrarComprobanteOriginal(): void {
    this.ticketOriginal.set(null);
    this.comprobanteOriginal.set(null);
  }

  /** Igual que Proformas: abre wa.me y deja al usuario adjuntar el PDF emitido. */
  abrirWhatsAppComprobante(): void {
    const ticket = this.ticketOriginal();
    if (!ticket) return;
    const telefono = ticket.cliente_telefono?.trim();
    const digitos =
      telefono && /^\+?[\d\s().-]+$/.test(telefono)
        ? telefono.replace(/[\s().-]/g, '').replace(/^\+/, '')
        : '';
    const nacional =
      digitos.length === 8
        ? digitos
        : digitos.length === 11 && digitos.startsWith('502')
          ? digitos.slice(3)
          : '';
    // Conserva la validación de Guatemala usada por Proformas y evita URLs inválidas.
    if (!/^[2-7]\d{7}$/.test(nacional)) {
      this.errorHistorial.set('El cliente no tiene un número de WhatsApp válido registrado.');
      return;
    }
    const total = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(ticket.total));
    const mensaje = `Buen día, ${ticket.cliente_nombre}.\n\n${ticket.empresa_nombre || 'Multiservicios Tale'} le comparte el Comprobante ${ticket.numero}.\n\nTotal: Q${total}\n\nLe compartimos el documento para su revisión.\n\n${ticket.agradecimiento}`;
    this.errorHistorial.set('');
    window.open(
      `https://wa.me/502${nacional}?text=${encodeURIComponent(mensaje)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  /** Imprime exclusivamente el PDF emitido; esta consulta no crea pagos ni archivos. */
  imprimirComprobanteHistorial(comprobante: ComprobanteResumen): void {
    if (this.descargandoComprobante()) return;
    this.descargandoComprobante.set(true);
    this.errorHistorial.set('');
    this.cobrosService
      .descargarComprobantePdf(comprobante.id_comprobante)
      .pipe(finalize(() => this.descargandoComprobante.set(false)))
      .subscribe({
        next: (contenido) => {
          const url = URL.createObjectURL(contenido);
          const marco = document.createElement('iframe');
          marco.title = `Comprobante ${comprobante.numero}`;
          marco.style.cssText = 'position:fixed;width:1px;height:1px;border:0;left:-9999px';
          const limpiar = (): void => {
            marco.remove();
            URL.revokeObjectURL(url);
          };
          marco.onload = () => {
            try {
              if (!marco.contentWindow) throw new Error('Vista de impresión no disponible');
              marco.contentWindow.addEventListener('afterprint', limpiar, { once: true });
              marco.contentWindow.print();
            } catch {
              this.errorHistorial.set(
                'No fue posible imprimir el PDF. Puede descargarlo desde el historial.',
              );
              limpiar();
            }
          };
          marco.onerror = () => {
            this.errorHistorial.set('No fue posible abrir el PDF para imprimir.');
            limpiar();
          };
          marco.src = url;
          document.body.appendChild(marco);
          // Libera el recurso si el visor PDF no emite afterprint.
          window.setTimeout(limpiar, 300000);
        },
        error: () => this.errorHistorial.set('No fue posible consultar el PDF para imprimir.'),
      });
  }

  private descargarComprobante(
    idComprobante: number,
    numero: string,
    mostrarError: (mensaje: string) => void,
  ): void {
    if (this.descargandoComprobante()) return;
    this.descargandoComprobante.set(true);
    mostrarError('');
    // La descarga usa una copia térmica actual; el PDF histórico conserva su endpoint.
    this.cobrosService
      .descargarComprobantePdfTermico(idComprobante)
      .pipe(finalize(() => this.descargandoComprobante.set(false)))
      .subscribe({
        next: (contenido) => {
          const url = URL.createObjectURL(contenido);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = `${numero}.pdf`;
          document.body.appendChild(enlace);
          enlace.click();
          enlace.remove();
          URL.revokeObjectURL(url);
        },
        error: () =>
          mostrarError('No fue posible descargar el comprobante PDF. Intente nuevamente.'),
      });
  }

  private restaurarAnchoTicket(): void {
    // El comprobante y su PDF usan exclusivamente el formato térmico de 58 mm.
    this.anchoTicket.set('58');
  }

  actualizarBusqueda(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLInputElement) this.busqueda.set(control.value);
  }

  actualizarPeriodo(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLInputElement) this.filtroPeriodo.set(control.value);
  }

  actualizarEstado(event: Event): void {
    const control = event.target;
    if (control instanceof HTMLSelectElement) this.filtroEstado.set(control.value as FiltroEstado);
  }

  etiquetaCategoria(): string {
    return this.categorias.find(({ valor }) => valor === this.categoriaActiva())?.etiqueta ?? '';
  }

  private aplicacionesAnticipoOrden(): {
    id_cobro: number;
    concepto: string;
    monto_aplicado: number;
  }[] {
    const cotizacion = this.cotizacionOrdenSeleccionada();
    const anticipo = this.anticipoSeleccionado();
    if (cotizacion?.id_cobro == null || anticipo === null) return [];
    const monto = this.redondearMoneda(
      Math.min(Number(anticipo.monto_no_aplicado), Number(cotizacion.saldo_pendiente)),
    );
    return monto > 0
      ? [
          {
            id_cobro: cotizacion.id_cobro,
            concepto: `Orden ${cotizacion.codigo_orden}`,
            monto_aplicado: monto,
          },
        ]
      : [];
  }

  private aplicacionesAnticipoInstalacion(): {
    id_cobro: number;
    concepto: string;
    monto_aplicado: number;
  }[] {
    const cotizacion = this.cotizacionInstalacionSeleccionada();
    const anticipo = this.anticipoSeleccionado();
    if (cotizacion?.id_cobro == null || anticipo === null) return [];
    const monto = this.redondearMoneda(
      Math.min(Number(anticipo.monto_no_aplicado), Number(cotizacion.saldo_pendiente)),
    );
    return monto > 0
      ? [
          {
            id_cobro: cotizacion.id_cobro,
            concepto: `Cotización ${cotizacion.numero_cotizacion}`,
            monto_aplicado: monto,
          },
        ]
      : [];
  }

  private construirPago(): RegistroPagoCreate {
    const clienteId = this.clienteSeleccionadoId();
    const metodoId = this.metodoPago();
    if (clienteId === null || metodoId === null) throw new Error('Pago incompleto');
    const clave = this.claveIdempotencia() ?? crypto.randomUUID();
    this.claveIdempotencia.set(clave);
    if (this.categoriaRegistro() === 'ORDENES_TRABAJO') {
      const cotizacion = this.cotizacionOrdenSeleccionada();
      if (cotizacion === null) throw new Error('Cotización de orden incompleta');
      return {
        id_cliente: clienteId,
        origen_financiero: 'ORDENES_TRABAJO',
        clave_idempotencia: clave,
        id_metodo_pago: metodoId,
        monto_total: this.redondearMoneda(this.montoPago()),
        tipo_pago: this.tipoPagoOrden(),
        referencia: this.referenciaPago().trim() || null,
        observaciones: this.observacionesPago().trim() || null,
        id_cotizacion: cotizacion.id_cotizacion,
        aplicaciones: [],
      };
    }
    if (this.categoriaRegistro() === 'INSTALACIONES') {
      const cotizacion = this.cotizacionInstalacionSeleccionada();
      if (cotizacion === null) throw new Error('Cotización de instalación incompleta');
      return {
        id_cliente: clienteId,
        origen_financiero: 'INSTALACIONES',
        clave_idempotencia: clave,
        id_metodo_pago: metodoId,
        monto_total: this.redondearMoneda(this.montoPago()),
        tipo_pago: this.tipoPagoInstalacion(),
        referencia: this.referenciaPago().trim() || null,
        observaciones: this.observacionesPago().trim() || null,
        id_cotizacion: cotizacion.id_cotizacion,
        aplicaciones: [],
      };
    }
    let disponible = this.montoPago();
    const aplicaciones = this.obligacionesRegistro()
      .filter(
        (obligacion): obligacion is ObligacionCobroVisual & { id: number } =>
          typeof obligacion.id === 'number' && this.obligacionesSeleccionadas().has(obligacion.id),
      )
      .sort((a, b) => a.id - b.id)
      .flatMap((obligacion) => {
        const montoAplicado = Math.min(obligacion.saldo, disponible);
        disponible = this.redondearMoneda(disponible - montoAplicado);
        return montoAplicado > 0
          ? [
              {
                id_cobro: obligacion.id,
                concepto: obligacion.concepto,
                monto_aplicado: this.redondearMoneda(montoAplicado),
              },
            ]
          : [];
      });
    const periodosInternet = this.periodosInternetProyectados()
      .filter((periodo) => this.obligacionesSeleccionadas().has(periodo.id))
      .map((periodo) => {
        const [, idServicio, periodoPago] = String(periodo.id).split(':');
        return { id_servicio: Number(idServicio), periodo: periodoPago };
      });
    return {
      id_cliente: clienteId,
      origen_financiero: 'INTERNET',
      clave_idempotencia: clave,
      id_metodo_pago: metodoId,
      monto_total: this.redondearMoneda(this.montoPago()),
      referencia: this.referenciaPago().trim() || null,
      observaciones: this.observacionesPago().trim() || null,
      aplicaciones,
      ...(periodosInternet.length > 0 ? { periodos_internet: periodosInternet } : {}),
    };
  }

  private adaptarCobro(cobro: CobroSaldo): CobroVista {
    const monto = Number(cobro.monto);
    return {
      id: cobro.id_cobro,
      tieneComprobante: cobro.tiene_comprobante ?? false,
      clienteId: cobro.id_cliente,
      servicioId: cobro.id_servicio,
      categoria: cobro.origen_financiero,
      cliente: cobro.cliente_nombre,
      telefonoCliente: cobro.cliente_telefono,
      codigo:
        cobro.codigo_orden ??
        (cobro.id_instalacion !== null
          ? `#${cobro.id_instalacion}`
          : cobro.id_servicio !== null
            ? `#${cobro.id_servicio}`
            : `#${cobro.id_cobro}`),
      comprobante: cobro.numero_cotizacion,
      periodo: cobro.periodo,
      fecha: cobro.fecha_emision,
      monto,
      vencimiento: cobro.fecha_vencimiento,
      estadoCobro: cobro.estado.toUpperCase() as EstadoCobro,
      proforma: cobro.id_proforma === null ? null : `#${cobro.id_proforma}`,
      montoAutorizado: monto,
      totalAbonado: Number(cobro.total_pagado),
      saldoPendiente: Number(cobro.saldo_pendiente),
      tipoInstalacion: cobro.tipo_instalacion,
    };
  }

  private adaptarClientes(clientes: Cliente[]): ClienteCobroVisual[] {
    return clientes
      .filter((cliente) => cliente.estado === 'Activo')
      .map((cliente) => ({
        id: cliente.id_cliente,
        nombre: `${cliente.nombres} ${cliente.apellidos}`.trim(),
        codigo: `#${cliente.id_cliente}`,
        telefono: cliente.telefono,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  private cargarCotizacionesOrden(clienteId: number): void {
    if (this.categoriaRegistro() !== 'ORDENES_TRABAJO') return;
    this.cargandoCotizacionesOrden.set(true);
    this.errorCotizacionesOrden.set('');
    this.cotizacionesOrden.set([]);
    this.cotizacionOrdenSeleccionadaId.set(null);
    this.cobrosService
      .listarCotizacionesOrden(clienteId)
      .pipe(finalize(() => this.cargandoCotizacionesOrden.set(false)))
      .subscribe({
        next: (cotizaciones) => {
          this.cotizacionesOrden.set(cotizaciones);
          if (cotizaciones.length === 1) {
            this.cotizacionOrdenSeleccionadaId.set(cotizaciones[0].id_cotizacion);
            this.montoPago.set(
              this.registrandoPendiente() ? 0 : Number(cotizaciones[0].saldo_pendiente),
            );
          }
        },
        error: (error: unknown) =>
          this.errorCotizacionesOrden.set(
            getApiErrorMessage(
              error,
              'No fue posible consultar las cotizaciones de órdenes de trabajo.',
            ),
          ),
      });
  }

  private cargarCotizacionesInstalacion(clienteId: number, idCobroObjetivo?: number): void {
    if (this.categoriaRegistro() !== 'INSTALACIONES') return;
    this.cargandoCotizacionesInstalacion.set(true);
    this.errorCotizacionesInstalacion.set('');
    this.cotizacionesInstalacion.set([]);
    this.cotizacionInstalacionSeleccionadaId.set(null);
    this.cobrosService
      .listarCotizacionesInstalacion(clienteId)
      .pipe(finalize(() => this.cargandoCotizacionesInstalacion.set(false)))
      .subscribe({
        next: (cotizaciones) => {
          this.cotizacionesInstalacion.set(cotizaciones);
          // Desde una obligación concreta se preselecciona su cotización; si
          // solo existe una, se elige automáticamente como en las órdenes.
          const objetivo =
            idCobroObjetivo !== undefined
              ? (cotizaciones.find((item) => item.id_cobro === idCobroObjetivo) ?? null)
              : cotizaciones.length === 1
                ? cotizaciones[0]
                : null;
          if (objetivo !== null) {
            this.cotizacionInstalacionSeleccionadaId.set(objetivo.id_cotizacion);
            this.montoPago.set(this.registrandoPendiente() ? 0 : Number(objetivo.saldo_pendiente));
          }
        },
        error: (error: unknown) =>
          this.errorCotizacionesInstalacion.set(
            getApiErrorMessage(
              error,
              'No fue posible consultar las cotizaciones de instalaciones.',
            ),
          ),
      });
  }

  private cargarAnticipos(clienteId: number, categoria: CategoriaCobro): void {
    const consultaId = ++this.consultaAnticiposId;
    this.anticipoSeleccionadoId.set(null);
    this.anticipos.set([]);
    if (categoria !== 'INSTALACIONES' && categoria !== 'ORDENES_TRABAJO') {
      this.cargandoAnticipos.set(false);
      return;
    }
    this.cargandoAnticipos.set(true);
    this.cobrosService
      .listarTodosAnticipos(clienteId, categoria)
      .pipe(
        finalize(() => {
          if (consultaId === this.consultaAnticiposId) this.cargandoAnticipos.set(false);
        }),
      )
      .subscribe({
        next: (anticipos) => {
          if (consultaId === this.consultaAnticiposId) this.anticipos.set(anticipos);
        },
        error: (error: unknown) => {
          if (consultaId === this.consultaAnticiposId) {
            this.errorPago.set(
              getApiErrorMessage(error, 'No fue posible consultar los anticipos del cliente.'),
            );
          }
        },
      });
  }

  private limpiarSeleccionPago(): void {
    this.obligacionesSeleccionadas.set(new Set());
    this.anticipoSeleccionadoId.set(null);
    this.cotizacionOrdenSeleccionadaId.set(null);
    this.cotizacionesOrden.set([]);
    this.errorCotizacionesOrden.set('');
    this.cotizacionInstalacionSeleccionadaId.set(null);
    this.cotizacionesInstalacion.set([]);
    this.errorCotizacionesInstalacion.set('');
    this.montoPago.set(0);
    this.tipoPagoOrden.set('TOTAL');
    this.tipoPagoInstalacion.set('TOTAL');
    this.reiniciarIntentoPago();
  }

  private reiniciarIntentoPago(): void {
    this.claveIdempotencia.set(null);
    this.errorPago.set('');
  }

  private importeResumen(cobro: CobroVista): number {
    return cobro.estadoCobro === 'PAGADO' ? cobro.montoAutorizado : cobro.saldoPendiente;
  }

  private redondearMoneda(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }

  private fechaLocalActual(): string {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(
      hoy.getDate(),
    ).padStart(2, '0')}`;
  }

  private normalizar(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  puedeRegistrarPagos(categoria: CategoriaCobro): boolean {
    return (
      this.auth.isAdministrator() || this.auth.hasModule(PAYMENT_MODULE_BY_CATEGORY[categoria])
    );
  }

  private categoriaAutorizada(categoria: CategoriaCobro): boolean {
    if (categoria === 'INTERNET') {
      return (
        this.puedeRegistrarPagos(categoria) ||
        this.puedeAdministrarVencimientos() ||
        this.puedeGenerarMensualidades()
      );
    }
    return this.puedeRegistrarPagos(categoria);
  }

  private ajustarCategoriasIniciales(): void {
    const categorias = this.categoriasVisibles();
    const primera = categorias[0]?.valor;
    if (!primera) return;
    if (!this.categoriaAutorizada(this.categoriaActiva())) {
      this.categoriaActiva.set(primera);
    }
    if (!this.categoriaAutorizada(this.categoriaRegistro())) {
      this.categoriaRegistro.set(primera);
    }
  }
}
