// ==========================================
// IMPORTS
// ==========================================
import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Observable, Subject, catchError, finalize, forkJoin, of, switchMap } from 'rxjs';

import { getApiErrorMessage } from '../../core/utils/api-error';
import { AuthService } from '../auth/services/auth.service';
import { DashboardBarChartComponent } from './components/bar-chart/bar-chart.component';
import { DashboardLineChartComponent } from './components/line-chart/line-chart.component';
import {
  BarraDashboard,
  ConteoModulo,
  DashboardAlerta,
  DashboardComercial,
  DashboardFiltro,
  DashboardFinanciero,
  DashboardOperativo,
  EstadoOperativoDashboard,
  LineaSerieDashboard,
  ModuloOperativoDashboard,
  OpcionPeriodoDashboard,
  PeriodoDashboard,
  ReporteCajaDashboard,
  ResumenDashboard,
} from './models/dashboard.models';
import { DashboardService } from './services/dashboard.service';

interface CargaDashboard {
  resumen: ResumenDashboard;
  financiero: DashboardFinanciero;
  comercial: DashboardComercial;
  operativo: DashboardOperativo;
  caja: ReporteCajaDashboard | null;
}

// ==========================================
// COMPONENTE DASHBOARD GERENCIAL
// ==========================================
@Component({
  selector: 'app-dashboard',
  imports: [
    CurrencyPipe,
    RouterLink,
    DashboardLineChartComponent,
    DashboardBarChartComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // switchMap cancela una carga anterior cuando el usuario cambia de período.
  private readonly recargas$ = new Subject<DashboardFiltro>();

  readonly periodos: OpcionPeriodoDashboard[] = [
    { codigo: 'hoy', nombre: 'Hoy' },
    { codigo: 'semana', nombre: 'Semana' },
    { codigo: 'mes', nombre: 'Mes' },
    { codigo: 'personalizado', nombre: 'Personalizado' },
  ];
  readonly tarjetasCarga = [1, 2, 3, 4, 5, 6, 7];

  readonly periodo = signal<PeriodoDashboard>('mes');
  readonly fechaInicio = signal(this.fechaActual());
  readonly fechaFin = signal(this.fechaActual());
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly resumen = signal<ResumenDashboard | null>(null);
  readonly financiero = signal<DashboardFinanciero | null>(null);
  readonly comercial = signal<DashboardComercial | null>(null);
  readonly operativo = signal<DashboardOperativo | null>(null);
  readonly reporteCaja = signal<ReporteCajaDashboard | null>(null);
  readonly errorCaja = signal('');

  // ==========================================
  // INDICADORES DERIVADOS
  // ==========================================
  /** El reporte de Caja General es administrativo y no admite rango personalizado. */
  readonly cajaDisponible = computed(
    () => this.auth.isAdministrator() && this.periodo() !== 'personalizado',
  );

  readonly financieroActual = computed(
    () => this.resumen()?.financiero ?? this.financiero()?.indicadores ?? null,
  );
  readonly clientes = computed(
    () => this.resumen()?.clientes ?? this.comercial()?.clientes ?? null,
  );
  readonly servicios = computed(
    () => this.resumen()?.servicios ?? this.comercial()?.servicios ?? null,
  );
  readonly periodoInfo = computed(
    () => this.resumen()?.periodo ?? this.financiero()?.periodo ?? null,
  );
  readonly actualizadoEn = computed(
    () =>
      this.resumen()?.generado_en ??
      this.financiero()?.generado_en ??
      this.comercial()?.generado_en ??
      this.operativo()?.generado_en ??
      null,
  );

  /** Indica si el período consultado no contiene actividad real del negocio. */
  readonly sinDatos = computed(() => {
    const resumen = this.resumen();
    if (!resumen) return false;
    const operaciones = [
      resumen.operativo.visitas_tecnicas.total,
      resumen.operativo.instalaciones.total,
      resumen.operativo.cotizaciones.total,
      resumen.operativo.ordenes_trabajo.total,
      resumen.operativo.tickets.total,
    ].reduce((total, valor) => total + valor, 0);
    const financiero = resumen.financiero;
    const sinFinanzas =
      this.numero(financiero.ingresos) === 0 &&
      this.numero(financiero.cobros_aplicados) === 0 &&
      this.numero(financiero.cartera_pendiente) === 0 &&
      this.numero(financiero.morosidad_monto) === 0;
    return (
      sinFinanzas &&
      resumen.clientes.total === 0 &&
      resumen.servicios.total === 0 &&
      operaciones === 0
    );
  });

  readonly lineasFinancieras = computed<LineaSerieDashboard[]>(() => {
    const series = this.financiero()?.series;
    if (!series) return [];
    return [
      {
        nombre: 'Ingresos confirmados',
        color: '#2563eb',
        valores: series.ingresos.map((punto) => this.numero(punto.monto)),
      },
      {
        nombre: 'Cobros aplicados',
        color: '#0f9f8f',
        valores: series.cobros_aplicados.map((punto) => this.numero(punto.monto)),
      },
    ];
  });
  readonly etiquetasFinancieras = computed(() =>
    (this.financiero()?.series.ingresos ?? []).map((punto) =>
      this.formatearFechaCorta(punto.fecha),
    ),
  );

  readonly lineasCartera = computed<LineaSerieDashboard[]>(() => {
    const serie = this.financiero()?.series.cartera_por_vencimiento;
    if (!serie) return [];
    return [
      {
        nombre: 'Cartera por vencimiento',
        color: '#d97706',
        valores: serie.map((punto) => this.numero(punto.monto)),
      },
    ];
  });
  readonly etiquetasCartera = computed(() =>
    (this.financiero()?.series.cartera_por_vencimiento ?? []).map((punto) =>
      this.formatearFechaCorta(punto.fecha),
    ),
  );

  readonly lineasComerciales = computed<LineaSerieDashboard[]>(() => {
    const serie = this.comercial()?.series.importe_cotizado;
    if (!serie) return [];
    return [
      {
        nombre: 'Importe cotizado',
        color: '#7c3aed',
        valores: serie.map((punto) => this.numero(punto.monto)),
      },
    ];
  });
  readonly etiquetasComerciales = computed(() =>
    (this.comercial()?.series.importe_cotizado ?? []).map((punto) =>
      this.formatearFechaCorta(punto.fecha),
    ),
  );

  readonly lineasOperativas = computed<LineaSerieDashboard[]>(() => {
    const series = this.operativo()?.series;
    if (!series) return [];
    const claves = [
      'visitas_tecnicas',
      'instalaciones',
      'cotizaciones',
      'ordenes_trabajo',
      'tickets',
    ] as const;
    const totalPuntos = Math.max(
      ...claves.map((clave) => series[clave].length),
      0,
    );
    const valores = Array.from({ length: totalPuntos }, (_, indice) =>
      claves.reduce(
        (total, clave) => total + Number(series[clave][indice]?.cantidad ?? 0),
        0,
      ),
    );
    return [{ nombre: 'Registros operativos', color: '#2563eb', valores }];
  });
  readonly etiquetasOperativas = computed(() =>
    (this.operativo()?.series.tickets ?? []).map((punto) =>
      this.formatearFechaCorta(punto.fecha),
    ),
  );

  readonly barrasOrigenIngresos = computed<BarraDashboard[]>(() =>
    (this.financieroActual()?.ingresos_por_origen ?? []).map((item) => ({
      etiqueta: this.etiquetaOrigen(item.origen),
      valor: this.numero(item.monto),
      detalle: `${item.cantidad} pago${item.cantidad === 1 ? '' : 's'}`,
    })),
  );

  readonly barrasCotizaciones = computed<BarraDashboard[]>(() =>
    (
      this.comercial()?.cotizaciones.por_estado ??
      this.resumen()?.operativo.cotizaciones.por_estado ??
      []
    ).map((item) => ({
      etiqueta: item.estado,
      valor: item.cantidad,
      color: this.colorEstado(item.estado),
    })),
  );

  readonly modulosOperativos = computed<ModuloOperativoDashboard[]>(() => {
    const operativo = this.resumen()?.operativo ?? this.operativo()?.operativo;
    if (!operativo) return [];
    return [
      this.crearModulo('visitas', 'Visitas técnicas', operativo.visitas_tecnicas),
      this.crearModulo('instalaciones', 'Instalaciones', operativo.instalaciones),
      this.crearModulo('cotizaciones', 'Cotizaciones', operativo.cotizaciones),
      this.crearModulo('ordenes', 'Órdenes de trabajo', operativo.ordenes_trabajo),
      this.crearModulo('tickets', 'Tickets', operativo.tickets),
    ];
  });

  /**
   * Construye alertas únicamente con datos reales ya consultados.
   *
   * La prioridad de tickets y el inventario bajo no se incluyen porque los
   * endpoints y estructuras actuales no exponen esos datos. No se inventan
   * valores sustitutos.
   */
  readonly alertas = computed<DashboardAlerta[]>(() => {
    const alertas: DashboardAlerta[] = [];
    const financiero = this.financieroActual();
    if (financiero && financiero.documentos_vencidos > 0) {
      alertas.push({
        nivel: 'critica',
        titulo: 'Cobros vencidos',
        mensaje: `${financiero.documentos_vencidos} cobro${
          financiero.documentos_vencidos === 1 ? '' : 's'
        } con saldo vencido.`,
        monto: financiero.morosidad_monto,
      });
    }

    const serviciosActuales = this.servicios();
    const suspendidos = (serviciosActuales?.por_estado ?? []).reduce(
      (total, item) =>
        this.esServicioSuspendido(item.estado) ? total + item.cantidad : total,
      0,
    );
    if (suspendidos > 0) {
      alertas.push({
        nivel: 'atencion',
        titulo: 'Servicios suspendidos',
        mensaje: `${suspendidos} servicio${
          suspendidos === 1 ? '' : 's'
        } de Internet requiere revisión.`,
      });
    }

    const operativo = this.resumen()?.operativo ?? this.operativo()?.operativo;
    const programadas =
      operativo?.instalaciones.por_estado.find(
        (item) => this.normalizarEstado(item.estado) === 'PROGRAMADA',
      )?.cantidad ?? 0;
    if (programadas > 0) {
      alertas.push({
        nivel: 'informativa',
        titulo: 'Instalaciones programadas pendientes',
        mensaje: `${programadas} instalación${
          programadas === 1 ? '' : 'es'
        } pendiente${programadas === 1 ? '' : 's'} de ejecución.`,
      });
    }

    return alertas;
  });

  // ==========================================
  // CICLO DE VIDA Y CARGA
  // ==========================================
  constructor() {
    this.recargas$
      .pipe(
        switchMap((filtro) => {
          this.cargando.set(true);
          this.error.set('');
          return forkJoin({
            resumen: this.dashboardService.obtenerResumen(filtro),
            financiero: this.dashboardService.obtenerFinanciero(filtro),
            comercial: this.dashboardService.obtenerComercial(filtro),
            operativo: this.dashboardService.obtenerOperativo(filtro),
            caja: this.solicitarCaja(filtro),
          }).pipe(
            catchError((error: unknown) => {
              this.error.set(
                getApiErrorMessage(
                  error,
                  'No fue posible cargar la información del Dashboard Gerencial.',
                ),
              );
              return of(null);
            }),
            finalize(() => this.cargando.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((resultado: CargaDashboard | null) => {
        if (!resultado) return;
        this.resumen.set(resultado.resumen);
        this.financiero.set(resultado.financiero);
        this.comercial.set(resultado.comercial);
        this.operativo.set(resultado.operativo);
        this.reporteCaja.set(resultado.caja);
      });
  }

  ngOnInit(): void {
    this.solicitar({ periodo: this.periodo() });
  }

  // ==========================================
  // FILTROS
  // ==========================================
  seleccionarPeriodo(periodo: PeriodoDashboard): void {
    if (periodo === this.periodo()) return;
    this.periodo.set(periodo);
    if (periodo !== 'personalizado') {
      this.solicitar({ periodo });
    }
  }

  actualizarFechaInicio(event: Event): void {
    this.fechaInicio.set((event.target as HTMLInputElement).value);
  }

  actualizarFechaFin(event: Event): void {
    this.fechaFin.set((event.target as HTMLInputElement).value);
  }

  /** Valida el rango personalizado antes de consultar a FastAPI. */
  aplicarPersonalizado(): void {
    const fechaInicio = this.fechaInicio();
    const fechaFin = this.fechaFin();
    if (!fechaInicio || !fechaFin) {
      this.error.set('Seleccione la fecha inicial y final del período.');
      return;
    }
    if (fechaInicio > fechaFin) {
      this.error.set('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    this.solicitar({
      periodo: 'personalizado',
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    });
  }

  /** Actualiza con el filtro vigente evitando solicitudes simultáneas duplicadas. */
  actualizar(): void {
    if (this.periodo() === 'personalizado') {
      this.aplicarPersonalizado();
      return;
    }
    this.solicitar({ periodo: this.periodo() });
  }

  private solicitar(filtro: DashboardFiltro): void {
    this.recargas$.next(filtro);
  }

  /**
   * Solicita el resumen ya calculado de Caja General.
   *
   * Solo se consulta para el perfil Administrador y para los períodos que el
   * reporte existente soporta. Un fallo de Caja no invalida el resto del
   * Dashboard ni se sustituye con cálculos propios en Angular.
   */
  private solicitarCaja(filtro: DashboardFiltro): Observable<ReporteCajaDashboard | null> {
    const periodo = filtro.periodo;
    this.errorCaja.set('');
    if (!this.auth.isAdministrator() || periodo === 'personalizado') {
      return of(null);
    }
    return this.dashboardService.obtenerResumenCaja(periodo).pipe(
      catchError(() => {
        this.errorCaja.set(
          'No fue posible cargar el resumen de Caja General para este período.',
        );
        return of(null);
      }),
    );
  }

  // ==========================================
  // APOYO DE PRESENTACIÓN
  // ==========================================
  formatearFechaHora(value: string): string {
    return new Intl.DateTimeFormat('es-GT', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private crearModulo(
    clave: string,
    nombre: string,
    modulo: ConteoModulo,
  ): ModuloOperativoDashboard {
    return {
      clave,
      nombre,
      total: modulo.total,
      estados: modulo.por_estado.map<EstadoOperativoDashboard>((item) => ({
        estado: item.estado,
        cantidad: item.cantidad,
        porcentaje:
          modulo.total > 0 ? (item.cantidad / modulo.total) * 100 : 0,
        color: this.colorEstado(item.estado),
      })),
    };
  }

  private formatearFechaCorta(value: string): string {
    const [anio, mes, dia] = value.slice(0, 10).split('-').map(Number);
    if (!anio || !mes || !dia) return value;
    if (this.periodoInfo()?.granularidad === 'mensual') {
      return new Intl.DateTimeFormat('es-GT', {
        month: 'short',
        year: '2-digit',
      }).format(new Date(anio, mes - 1, dia));
    }
    return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
  }

  private numero(valor: string | number | null | undefined): number {
    const numero = Number(valor ?? 0);
    return Number.isFinite(numero) ? numero : 0;
  }

  private etiquetaOrigen(origen: string): string {
    const etiquetas: Record<string, string> = {
      INTERNET: 'Internet',
      INSTALACIONES: 'Instalaciones',
      ORDENES_TRABAJO: 'Órdenes de trabajo',
    };
    return etiquetas[origen] ?? origen;
  }

  /** Normaliza estados para comparar sin depender de tildes ni mayúsculas. */
  private normalizarEstado(estado: string): string {
    return estado
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  private esServicioSuspendido(estado: string): boolean {
    const normalizado = this.normalizarEstado(estado);
    return normalizado === 'SUSPENDIDO' || normalizado === 'SUSPENDIDA';
  }

  private colorEstado(estado: string): string {
    const colores: Record<string, string> = {
      Programada: '#d97706',
      'En Proceso': '#2563eb',
      'EN PROCESO': '#2563eb',
      Completada: '#0f9f8f',
      COMPLETADA: '#0f9f8f',
      Pendiente: '#94a3b8',
      GENERADA: '#d97706',
      ACEPTADA: '#0f9f8f',
      RECHAZADA: '#dc2626',
    };
    return colores[estado] ?? '#64748b';
  }

  private fechaActual(): string {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60_000;
    return new Date(hoy.getTime() - offset).toISOString().slice(0, 10);
  }
}
