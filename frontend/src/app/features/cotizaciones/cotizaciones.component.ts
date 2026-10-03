import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, finalize } from 'rxjs';

import { CotizacionesService } from '../../core/services/cotizaciones.service';
import { getApiErrorMessage } from '../../core/utils/api-error';
import {
  AccionCotizacion,
  CotizacionResponseDto,
  CotizacionVista,
  EstadoCotizacion,
  ESTADOS_COTIZACION,
  ProformaResponseDto,
  cotizacionResponseAVista,
  obtenerAccionesCotizacion,
} from './cotizacion.models';

type FiltroEstado = 'TODOS' | EstadoCotizacion;

interface ConfirmacionAccion {
  accion: Extract<AccionCotizacion, 'ACEPTAR' | 'RECHAZAR' | 'ELIMINAR' | 'GENERAR_PROFORMA'>;
  cotizacion: CotizacionVista;
}

// Pantalla principal preparada para recibir registros durante la fase HTTP. No
// simula persistencia ni transiciones mientras esa integración está pendiente.
@Component({
  selector: 'app-cotizaciones',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './cotizaciones.component.html',
  styleUrl: './cotizaciones.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CotizacionesComponent implements OnInit {
  private readonly cotizacionesService = inject(CotizacionesService);

  readonly cotizaciones = signal<CotizacionVista[]>([]);
  readonly cargando = signal(false);
  readonly errorCarga = signal('');
  readonly operacionActiva = signal<{ idCotizacion: number; accion: AccionCotizacion } | null>(null);
  readonly busqueda = signal('');
  readonly filtroEstado = signal<FiltroEstado>('TODOS');
  readonly estados = ESTADOS_COTIZACION;
  readonly mensajeAccion = signal('');
  readonly confirmacionAccion = signal<ConfirmacionAccion | null>(null);
  readonly cotizacionesFiltradas = computed(() => {
    const termino = this.normalizar(this.busqueda());
    const estado = this.filtroEstado();
    return this.cotizaciones().filter((cotizacion) => {
      const coincideEstado = estado === 'TODOS' || cotizacion.estado === estado;
      const texto = `${cotizacion.numero_cotizacion} ${cotizacion.cliente.nombres} ${cotizacion.cliente.apellidos}`;
      return coincideEstado && (!termino || this.normalizar(texto).includes(termino));
    });
  });

  ngOnInit(): void {
    this.cargarCotizaciones();
  }

  cargarCotizaciones(): void {
    this.cargando.set(true);
    this.errorCarga.set('');
    this.cotizacionesService
      .list()
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (cotizaciones) =>
          this.cotizaciones.set(cotizaciones.map(cotizacionResponseAVista)),
        error: (error: unknown) =>
          this.errorCarga.set(
            getApiErrorMessage(error, 'No fue posible cargar las cotizaciones.'),
          ),
      });
  }

  actualizarBusqueda(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.busqueda.set(input.value);
    }
  }

  actualizarEstado(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.filtroEstado.set(select.value as FiltroEstado);
    }
  }

  acciones(cotizacion: CotizacionVista): AccionCotizacion[] {
    return obtenerAccionesCotizacion(cotizacion);
  }

  total(cotizacion: CotizacionVista): number {
    return cotizacion.total;
  }

  etiquetaAccion(accion: AccionCotizacion): string {
    const etiquetas: Record<AccionCotizacion, string> = {
      VER: 'Ver',
      EDITAR: 'Editar',
      GENERAR_COTIZACION: 'Generar Cotización',
      ACEPTAR: 'Aceptar',
      RECHAZAR: 'Rechazar',
      ELIMINAR: 'Eliminar',
      GENERAR_PROFORMA: 'Generar Proforma',
      VER_PROFORMA: 'Ver Proforma',
    };
    return etiquetas[accion];
  }

  // Las transiciones sensibles solicitan confirmación, pero confirmar no cambia
  // el estado local ni representa persistencia antes de integrar FastAPI.
  solicitarConfirmacion(
    cotizacion: CotizacionVista,
    accion: ConfirmacionAccion['accion'],
  ): void {
    this.mensajeAccion.set('');
    this.confirmacionAccion.set({ cotizacion, accion });
  }

  cancelarConfirmacion(): void {
    this.confirmacionAccion.set(null);
  }

  confirmarAccion(): void {
    const confirmacion = this.confirmacionAccion();
    if (!confirmacion || this.operacionActiva()) {
      return;
    }
    switch (confirmacion.accion) {
      case 'ACEPTAR':
        this.ejecutarTransicion(
          confirmacion.cotizacion,
          'ACEPTAR',
          this.cotizacionesService.accept(confirmacion.cotizacion.id_cotizacion),
          'Cotización aceptada correctamente.',
        );
        break;
      case 'RECHAZAR':
        this.ejecutarTransicion(
          confirmacion.cotizacion,
          'RECHAZAR',
          this.cotizacionesService.reject(confirmacion.cotizacion.id_cotizacion),
          'Cotización rechazada correctamente.',
        );
        break;
      case 'ELIMINAR':
        this.ejecutarEliminacion(confirmacion.cotizacion);
        break;
      case 'GENERAR_PROFORMA':
        this.ejecutarGeneracionProforma(confirmacion.cotizacion);
        break;
    }
  }

  generarCotizacion(cotizacion: CotizacionVista): void {
    if (this.operacionActiva()) {
      return;
    }
    this.ejecutarTransicion(
      cotizacion,
      'GENERAR_COTIZACION',
      this.cotizacionesService.generate(cotizacion.id_cotizacion),
      'Cotización generada correctamente.',
    );
  }

  estaOperando(cotizacion: CotizacionVista, accion: AccionCotizacion): boolean {
    const operacion = this.operacionActiva();
    return operacion?.idCotizacion === cotizacion.id_cotizacion && operacion.accion === accion;
  }

  textoConfirmacion(confirmacion: ConfirmacionAccion): string {
    return `¿Desea ${this.etiquetaAccion(confirmacion.accion).toLowerCase()} la cotización ${confirmacion.cotizacion.numero_cotizacion}?`;
  }

  private ejecutarTransicion(
    cotizacion: CotizacionVista,
    accion: AccionCotizacion,
    request: Observable<CotizacionResponseDto>,
    mensajeExito: string,
  ): void {
    this.iniciarOperacion(cotizacion, accion);
    request
      .pipe(finalize(() => this.operacionActiva.set(null)))
      .subscribe({
        next: (response) => {
          this.reemplazarCotizacion(cotizacionResponseAVista(response));
          this.confirmacionAccion.set(null);
          this.mensajeAccion.set(mensajeExito);
        },
        error: (error: unknown) =>
          this.mensajeAccion.set(
            getApiErrorMessage(error, `No fue posible ${this.etiquetaAccion(accion).toLowerCase()} la cotización.`),
          ),
      });
  }

  private ejecutarEliminacion(cotizacion: CotizacionVista): void {
    this.iniciarOperacion(cotizacion, 'ELIMINAR');
    this.cotizacionesService
      .delete(cotizacion.id_cotizacion)
      .pipe(finalize(() => this.operacionActiva.set(null)))
      .subscribe({
        next: () => {
          this.cotizaciones.update((actuales) =>
            actuales.filter((actual) => actual.id_cotizacion !== cotizacion.id_cotizacion),
          );
          this.confirmacionAccion.set(null);
          this.mensajeAccion.set('Cotización eliminada correctamente.');
        },
        error: (error: unknown) =>
          this.mensajeAccion.set(
            getApiErrorMessage(error, 'No fue posible eliminar la cotización.'),
          ),
      });
  }

  private ejecutarGeneracionProforma(cotizacion: CotizacionVista): void {
    this.iniciarOperacion(cotizacion, 'GENERAR_PROFORMA');
    this.cotizacionesService
      .generateProforma(cotizacion.id_cotizacion)
      .pipe(finalize(() => this.operacionActiva.set(null)))
      .subscribe({
        next: (response: ProformaResponseDto) => {
          this.reemplazarCotizacion(cotizacionResponseAVista(response.cotizacion));
          this.confirmacionAccion.set(null);
          this.mensajeAccion.set('Proforma generada correctamente.');
        },
        error: (error: unknown) =>
          this.mensajeAccion.set(
            getApiErrorMessage(error, 'No fue posible generar la Proforma.'),
          ),
      });
  }

  private iniciarOperacion(cotizacion: CotizacionVista, accion: AccionCotizacion): void {
    this.mensajeAccion.set('');
    this.operacionActiva.set({ idCotizacion: cotizacion.id_cotizacion, accion });
  }

  private reemplazarCotizacion(cotizacion: CotizacionVista): void {
    this.cotizaciones.update((actuales) =>
      actuales.map((actual) =>
        actual.id_cotizacion === cotizacion.id_cotizacion ? cotizacion : actual,
      ),
    );
  }

  private normalizar(valor: string): string {
    return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
}
