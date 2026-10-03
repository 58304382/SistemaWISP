import { CurrencyPipe, Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, forkJoin, of, switchMap } from 'rxjs';

import { Cliente, Departamento } from '../../core/models/cliente.models';
import { ClientesService } from '../../core/services/clientes.service';
import { CotizacionesService } from '../../core/services/cotizaciones.service';
import { getApiErrorMessage } from '../../core/utils/api-error';
import {
  ClienteCotizacionVista,
  CotizacionDirectaCreateDto,
  CotizacionResponseDto,
  CotizacionUpdateDto,
  DetalleCotizacionDirectaInputDto,
  DetalleCotizacionFormulario,
  OrigenCotizacion,
  calcularResumenCotizacion,
  calcularSubtotalDetalle,
  cotizacionResponseAVista,
  detalleFormularioADto,
} from './cotizacion.models';

type VistaFormulario = 'FORMULARIO' | 'REVISION';
type ClienteFormulario = Cliente | ClienteCotizacionVista;

@Component({
  selector: 'app-cotizacion-form',
  imports: [CurrencyPipe, RouterLink],
  templateUrl: './cotizacion-form.component.html',
  styleUrl: './cotizacion-form.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CotizacionFormComponent implements OnInit {
  private readonly clientesService = inject(ClientesService);
  private readonly cotizacionesService = inject(CotizacionesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private siguienteDetalle = 2;

  readonly clientes = signal<Cliente[]>([]);
  readonly departamentos = signal<Departamento[]>([]);
  readonly cargandoClientes = signal(false);
  readonly errorClientes = signal('');
  readonly cargandoCotizacion = signal(false);
  readonly guardando = signal(false);
  readonly errorCarga = signal('');
  readonly busquedaCliente = signal('');
  readonly clienteSeleccionado = signal<ClienteFormulario | null>(null);
  readonly detalles = signal<DetalleCotizacionFormulario[]>([
    this.crearDetalle(1, this.esOrigenEvaluacionRuta() ? null : 0),
  ]);
  readonly porcentajeDescuento = signal(0);
  readonly vista = signal<VistaFormulario>('FORMULARIO');
  readonly intentoGuardar = signal(false);
  readonly mensajeGuardado = signal('');
  readonly cotizacionCargada = signal<ReturnType<typeof cotizacionResponseAVista> | null>(null);
  readonly datosModificados = signal(false);
  readonly operacionFinalizada = signal(false);
  // Solo una creación nueva usa la fecha local en revisión. Al persistir se reemplaza por FastAPI.
  readonly fechaCotizacion = signal(this.formatearFechaLocal(new Date()));
  readonly fechaCotizacionFormateada = computed(() => {
    const [anio, mes, dia] = this.fechaCotizacion().slice(0, 10).split('-');
    return `${dia}/${mes}/${anio}`;
  });
  readonly idCotizacion = computed(() => this.route.snapshot.paramMap.get('id'));
  readonly idEvaluacion = computed(() => this.route.snapshot.paramMap.get('idEvaluacion'));
  readonly origen = computed<OrigenCotizacion>(() =>
    this.cotizacionCargada()?.origen ??
    (this.esOrigenEvaluacionRuta() ? 'EVALUACION' : 'DIRECTA'),
  );
  readonly modoEdicion = computed(
    () => this.idCotizacion() !== null || this.cotizacionCargada() !== null,
  );
  readonly puedeEditar = computed(() => {
    const estado = this.cotizacionCargada()?.estado;
    return estado === undefined || estado === 'EN PROCESO' || estado === 'GENERADA';
  });
  readonly formularioBloqueado = computed(
    () => this.cargandoCotizacion() || this.guardando() || !this.puedeEditar(),
  );
  readonly puedeEditarEstructura = computed(
    () =>
      this.puedeEditar() &&
      (this.origen() === 'DIRECTA' || this.cotizacionCargada()?.estado === 'EN PROCESO'),
  );
  readonly titulo = computed(() => {
    if (this.vista() === 'REVISION') {
      return this.modoEdicion() ? 'Revisión de Cambios' : 'Revisión de Cotización';
    }
    return this.modoEdicion() ? 'Editar Cotización' : 'Nueva Cotización';
  });
  readonly clientesFiltrados = computed(() => {
    const termino = this.normalizar(this.busquedaCliente());
    if (!termino) {
      return [];
    }
    return this.clientes()
      .filter((cliente) =>
        this.normalizar(
          `${cliente.id_cliente} ${cliente.nombres} ${cliente.apellidos} ${cliente.telefono}`,
        ).includes(termino),
      )
      .slice(0, 8);
  });
  readonly resumen = computed(() => {
    const cotizacion = this.cotizacionCargada();
    if (cotizacion && !this.datosModificados()) {
      return {
        subtotal: cotizacion.subtotal,
        descuento: cotizacion.monto_descuento,
        total: cotizacion.total,
      };
    }
    return calcularResumenCotizacion(this.detalles(), this.porcentajeDescuento());
  });
  readonly detallesPreparados = computed(() => this.detalles().map(detalleFormularioADto));
  readonly preciosCompletos = computed(
    () =>
      this.detalles().length > 0 &&
      this.detalles().every((detalle) => detalle.precio_unitario !== null),
  );
  readonly formularioValido = computed(
    () =>
      this.clienteSeleccionado() !== null &&
      this.detalles().length > 0 &&
      this.detalles().every(
        (detalle) =>
          detalle.descripcion.trim().length > 0 &&
          detalle.cantidad > 0 &&
          detalle.precio_unitario !== null &&
          detalle.precio_unitario >= 0,
      ),
  );
  readonly formularioGuardable = computed(
    () =>
      this.clienteSeleccionado() !== null &&
      this.detalles().length > 0 &&
      this.detalles().every(
        (detalle) =>
          detalle.descripcion.trim().length > 0 &&
          detalle.cantidad > 0 &&
          (detalle.precio_unitario === null || detalle.precio_unitario >= 0),
      ),
  );
  readonly puedeGuardarEnProceso = computed(
    () =>
      this.cotizacionCargada()?.origen === 'EVALUACION' &&
      this.cotizacionCargada()?.estado === 'EN PROCESO',
  );
  readonly etiquetaRevision = computed(() =>
    this.origen() === 'EVALUACION' && this.cotizacionCargada()?.estado === 'EN PROCESO'
      ? 'Guardar y revisar'
      : this.modoEdicion()
        ? 'Revisar cambios'
        : 'Revisar cotización',
  );
  readonly etiquetaAccionFinal = computed(() => {
    const cotizacion = this.cotizacionCargada();
    if (!cotizacion || (cotizacion.origen === 'EVALUACION' && cotizacion.estado === 'EN PROCESO')) {
      return 'Generar cotización';
    }
    return 'Guardar cambios';
  });

  ngOnInit(): void {
    if (this.idCotizacion() !== null) {
      const idCotizacion = this.numeroRuta(this.idCotizacion());
      if (idCotizacion !== null) {
        this.cargarCotizacion(idCotizacion);
      }
      return;
    }
    if (this.idEvaluacion() !== null) {
      const idEvaluacion = this.numeroRuta(this.idEvaluacion());
      if (idEvaluacion !== null) {
        this.crearDesdeEvaluacion(idEvaluacion);
      }
      return;
    }
    this.cargarClientes();
  }

  cargarClientes(): void {
    this.cargandoClientes.set(true);
    this.errorClientes.set('');
    forkJoin({
      clientes: this.clientesService.getAll(),
      departamentos: this.clientesService.getDepartamentos(),
    })
      .pipe(finalize(() => this.cargandoClientes.set(false)))
      .subscribe({
        next: ({ clientes, departamentos }) => {
          this.clientes.set(clientes.filter((cliente) => cliente.estado === 'Activo'));
          this.departamentos.set(departamentos);
        },
        error: (error: unknown) =>
          this.errorClientes.set(getApiErrorMessage(error, 'No fue posible cargar los clientes.')),
      });
  }

  actualizarBusquedaCliente(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.busquedaCliente.set(input.value);
    }
  }

  seleccionarCliente(cliente: Cliente): void {
    this.clienteSeleccionado.set(cliente);
    this.busquedaCliente.set('');
    this.datosModificados.set(true);
  }

  cambiarCliente(): void {
    if (this.origen() === 'DIRECTA' && !this.modoEdicion() && !this.guardando()) {
      this.clienteSeleccionado.set(null);
      this.datosModificados.set(true);
    }
  }

  agregarConcepto(): void {
    if (this.puedeEditarEstructura()) {
      // Los conceptos agregados durante la evaluación quedan pendientes de precio.
      const precioInicial = this.origen() === 'EVALUACION' ? null : 0;
      this.detalles.update((detalles) => [
        ...detalles,
        this.crearDetalle(this.siguienteDetalle++, precioInicial),
      ]);
      this.datosModificados.set(true);
      this.operacionFinalizada.set(false);
    }
  }

  quitarConcepto(idTemporal: number): void {
    if (this.detalles().length > 1 && this.puedeEditarEstructura()) {
      this.detalles.update((detalles) =>
        detalles.filter((detalle) => detalle.idTemporal !== idTemporal),
      );
      this.datosModificados.set(true);
      this.operacionFinalizada.set(false);
    }
  }

  actualizarDetalle(
    idTemporal: number,
    campo: 'descripcion' | 'cantidad' | 'unidad' | 'precio_unitario',
    event: Event,
  ): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.formularioBloqueado()) {
      return;
    }
    this.detalles.update((detalles) =>
      detalles.map((detalle) => {
        if (detalle.idTemporal !== idTemporal) {
          return detalle;
        }
        let valor: string | number | null;
        if (campo === 'descripcion') {
          valor = input.value;
        } else if (campo === 'unidad') {
          valor = input.value.slice(0, 20);
        } else if (campo === 'precio_unitario') {
          valor = input.value === '' ? null : Number(input.value);
        } else {
          valor = Number(input.value);
        }
        return { ...detalle, [campo]: valor } as DetalleCotizacionFormulario;
      }),
    );
    this.datosModificados.set(true);
    this.operacionFinalizada.set(false);
  }

  actualizarDescuento(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement && !this.formularioBloqueado()) {
      this.porcentajeDescuento.set(Math.min(100, Math.max(0, Number(input.value) || 0)));
      this.datosModificados.set(true);
      this.operacionFinalizada.set(false);
    }
  }

  subtotalDetalle(detalle: DetalleCotizacionFormulario): number {
    if (!this.datosModificados() && detalle.id_detalle) {
      const persistido = this.cotizacionCargada()?.detalles.find(
        (actual) => actual.id_detalle === detalle.id_detalle,
      );
      if (persistido) {
        return persistido.subtotal_detalle;
      }
    }
    return calcularSubtotalDetalle(detalle);
  }

  mostrarRevision(): void {
    this.intentoGuardar.set(true);
    this.mensajeGuardado.set('');
    if (!this.formularioValido()) {
      this.mensajeGuardado.set(
        this.preciosCompletos()
          ? 'Complete el cliente y todos los conceptos antes de revisar.'
          : 'Complete todos los precios antes de guardar y revisar la cotización.',
      );
      return;
    }
    const cotizacion = this.cotizacionCargada();
    if (cotizacion?.origen === 'EVALUACION' && cotizacion.estado === 'EN PROCESO') {
      this.guardarEdicion(true);
      return;
    }
    this.vista.set('REVISION');
  }

  guardarCambiosEnProceso(): void {
    if (this.guardando() || !this.puedeGuardarEnProceso()) {
      return;
    }
    this.intentoGuardar.set(true);
    if (!this.formularioGuardable()) {
      this.mensajeGuardado.set('Revise los materiales antes de guardar los cambios.');
      return;
    }
    // PATCH conserva EN PROCESO incluso si después de guardar ya no quedan precios pendientes.
    this.guardarEdicion(false, false);
  }

  volverAEditar(): void {
    this.vista.set('FORMULARIO');
    this.mensajeGuardado.set('');
  }

  generarCotizacion(): void {
    if (this.guardando() || this.operacionFinalizada()) {
      return;
    }
    this.intentoGuardar.set(true);
    if (!this.formularioValido()) {
      this.vista.set('FORMULARIO');
      this.mensajeGuardado.set('Los datos cambiaron. Revise nuevamente la cotización.');
      return;
    }

    const cotizacion = this.cotizacionCargada();
    if (!cotizacion) {
      this.crearDirecta();
    } else if (cotizacion.origen === 'EVALUACION' && cotizacion.estado === 'EN PROCESO') {
      this.generarEvaluacion(cotizacion.id_cotizacion);
    } else {
      this.guardarEdicion(false);
    }
  }

  nombreCliente(cliente: ClienteFormulario): string {
    return `${cliente.nombres} ${cliente.apellidos}`.trim();
  }

  nombreClienteSeleccionado(): string {
    const cliente = this.clienteSeleccionado();
    return cliente ? this.nombreCliente(cliente) : '';
  }

  departamentoClienteSeleccionado(): string {
    const cliente = this.clienteSeleccionado();
    if (!cliente) {
      return 'No disponible';
    }
    if ('departamento' in cliente) {
      return cliente.departamento;
    }
    return (
      this.departamentos().find(
        (departamento) => departamento.id_departamento === cliente.municipio.id_departamento,
      )?.nombre ?? 'No disponible'
    );
  }

  municipioClienteSeleccionado(): string {
    const cliente = this.clienteSeleccionado();
    if (!cliente) {
      return 'No disponible';
    }
    return typeof cliente.municipio === 'string' ? cliente.municipio : cliente.municipio.nombre;
  }

  private cargarCotizacion(idCotizacion: number): void {
    this.cargandoCotizacion.set(true);
    this.errorCarga.set('');
    this.cotizacionesService
      .getById(idCotizacion)
      .pipe(finalize(() => this.cargandoCotizacion.set(false)))
      .subscribe({
        next: (response) => this.aplicarRespuesta(response),
        error: (error: unknown) =>
          this.errorCarga.set(getApiErrorMessage(error, 'No fue posible cargar la cotización.')),
      });
  }

  private crearDesdeEvaluacion(idEvaluacion: number): void {
    if (this.cargandoCotizacion()) {
      return;
    }
    this.cargandoCotizacion.set(true);
    this.errorCarga.set('');
    this.cotizacionesService
      .list()
      .pipe(
        // La finalización ya crea la cotización; las evaluaciones históricas conservan el alta manual.
        switchMap((cotizaciones) => {
          const existente = cotizaciones.find(
            (cotizacion) => cotizacion.id_evaluacion === idEvaluacion,
          );
          return existente
            ? of(existente)
            : this.cotizacionesService.createFromEvaluation({
                id_evaluacion: idEvaluacion,
                porcentaje_descuento: 0,
              });
        }),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cargandoCotizacion.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.aplicarRespuesta(response);
          void this.router.navigate(['/cotizaciones', response.id_cotizacion, 'editar'], {
            queryParams: { origen: response.origen },
            replaceUrl: true,
          });
        },
        error: (error: unknown) =>
          this.errorCarga.set(
            getApiErrorMessage(error, 'No fue posible abrir la cotización de la evaluación.'),
          ),
      });
  }

  private crearDirecta(): void {
    const cliente = this.clienteSeleccionado();
    if (!cliente || this.guardando()) {
      return;
    }
    const detalles: DetalleCotizacionDirectaInputDto[] = this.detallesPreparados().map(
      (detalle) => ({
        ...detalle,
        precio_unitario: detalle.precio_unitario as number,
      }),
    );
    const payload: CotizacionDirectaCreateDto = {
      id_cliente: cliente.id_cliente,
      porcentaje_descuento: this.porcentajeDescuento(),
      detalles,
    };
    this.ejecutarGuardado(
      this.cotizacionesService.createDirect(payload),
      'Cotización generada correctamente.',
      true,
      false,
      true,
    );
  }

  private guardarEdicion(mostrarRevision: boolean, finalizar = !mostrarRevision): void {
    const cotizacion = this.cotizacionCargada();
    if (!cotizacion || this.guardando()) {
      return;
    }
    const payload: CotizacionUpdateDto = {
      porcentaje_descuento: this.porcentajeDescuento(),
      detalles: this.detallesPreparados(),
    };
    this.ejecutarGuardado(
      this.cotizacionesService.update(cotizacion.id_cotizacion, payload),
      'Cambios guardados correctamente.',
      finalizar,
      mostrarRevision,
    );
  }

  private generarEvaluacion(idCotizacion: number): void {
    this.ejecutarGuardado(
      this.cotizacionesService.generate(idCotizacion),
      'Cotización generada correctamente.',
      true,
    );
  }

  private ejecutarGuardado(
    request: ReturnType<CotizacionesService['update']>,
    mensajeExito: string,
    finalizar: boolean,
    mostrarRevision = false,
    reemplazarRuta = false,
  ): void {
    if (this.guardando()) {
      return;
    }
    this.guardando.set(true);
    this.mensajeGuardado.set('');
    request.pipe(finalize(() => this.guardando.set(false))).subscribe({
      next: (response) => {
        this.aplicarRespuesta(response);
        this.operacionFinalizada.set(finalizar);
        this.mensajeGuardado.set(mensajeExito);
        if (reemplazarRuta) {
          // Conserva la confirmación visible y evita repetir POST al recargar.
          this.location.replaceState(
            `/cotizaciones/${response.id_cotizacion}/editar?origen=${response.origen}`,
          );
        }
        if (mostrarRevision) {
          this.vista.set('REVISION');
        }
      },
      error: (error: unknown) =>
        this.mensajeGuardado.set(
          getApiErrorMessage(error, 'No fue posible guardar la cotización.'),
        ),
    });
  }

  private aplicarRespuesta(response: CotizacionResponseDto): void {
    const cotizacion = cotizacionResponseAVista(response);
    this.cotizacionCargada.set(cotizacion);
    this.clienteSeleccionado.set(cotizacion.cliente);
    this.detalles.set(
      cotizacion.detalles.map((detalle, index) => ({
        idTemporal: index + 1,
        id_detalle: detalle.id_detalle,
        descripcion: detalle.descripcion,
        cantidad: detalle.cantidad,
        unidad: detalle.unidad,
        precio_unitario: detalle.precio_unitario,
      })),
    );
    this.siguienteDetalle = cotizacion.detalles.length + 1;
    this.porcentajeDescuento.set(cotizacion.porcentaje_descuento);
    this.fechaCotizacion.set(cotizacion.fecha);
    this.datosModificados.set(false);
    if (!this.puedeEditar()) {
      this.mensajeGuardado.set('El estado actual de la cotización no permite edición.');
    }
  }

  private crearDetalle(
    idTemporal: number,
    precioUnitario: number | null = 0,
  ): DetalleCotizacionFormulario {
    return {
      idTemporal,
      descripcion: '',
      cantidad: 1,
      unidad: null,
      precio_unitario: precioUnitario,
    };
  }

  private formatearFechaLocal(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }

  private esOrigenEvaluacionRuta(): boolean {
    return (
      this.route.snapshot.paramMap.has('idEvaluacion') ||
      this.route.snapshot.queryParamMap.get('origen') === 'EVALUACION'
    );
  }

  private numeroRuta(valor: string | null): number | null {
    if (valor === null) {
      return null;
    }
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero <= 0) {
      this.errorCarga.set('El identificador solicitado no es válido.');
      return null;
    }
    return numero;
  }

  private normalizar(valor: string): string {
    return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
}
