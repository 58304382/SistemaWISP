import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  ClienteInternetTemporal,
  EstadoServicioInternet,
  PlanInternetTemporal,
  ServicioInternetPayload,
  ServicioInternetTemporal,
} from '../../models/servicio-internet.models';
import { ServiciosInternetTemporalService } from '../../services/servicios-internet-temporal.service';

type EstadoFiltro = 'Todos' | EstadoServicioInternet;
type ResultadoSimulacion = 'pendiente' | 'procesando' | 'correcto' | 'ocupada';
type Aviso = { titulo: string; mensaje: string };

@Component({
  selector: 'app-servicios-internet',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './servicios-internet.component.html',
  styleUrl: './servicios-internet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiciosInternetComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly datosTemporales = inject(ServiciosInternetTemporalService);

  readonly servicios = signal(this.datosTemporales.listar());
  readonly clientes = this.datosTemporales.listarClientes();
  readonly planes = this.datosTemporales.listarPlanes();
  readonly busqueda = signal('');
  readonly estadoFiltro = signal<EstadoFiltro>('Todos');
  readonly planFiltro = signal(0);
  readonly formularioAbierto = signal(false);
  readonly paso = signal(1);
  readonly editando = signal<ServicioInternetTemporal | null>(null);
  readonly detalle = signal<ServicioInternetTemporal | null>(null);
  readonly enviado = signal(false);
  readonly resultadoIp = signal<ResultadoSimulacion>('pendiente');
  readonly resultadoConexion = signal<ResultadoSimulacion>('pendiente');
  readonly resultadoConfiguracion = signal<ResultadoSimulacion>('pendiente');
  readonly aviso = signal<Aviso | null>(null);

  readonly formulario = this.formBuilder.nonNullable.group({
    clienteId: [0, [Validators.required, Validators.min(1)]],
    planId: [0, [Validators.required, Validators.min(1)]],
    fechaInicio: ['', Validators.required],
    estado: ['Pendiente' as EstadoServicioInternet, Validators.required],
    zona: ['', [Validators.required, Validators.maxLength(80)]],
    descripcion: ['', Validators.maxLength(250)],
    ipv4: ['', [Validators.required, Validators.pattern(this.patronIpv4())]],
    mascara: ['255.255.255.0', [Validators.required, Validators.pattern(this.patronIpv4())]],
    gateway: ['', [Validators.required, Validators.pattern(this.patronIpv4())]],
    dnsPrimario: ['8.8.8.8', [Validators.required, Validators.pattern(this.patronIpv4())]],
    dnsSecundario: ['1.1.1.1', Validators.pattern(this.patronIpv4())],
    router: ['', [Validators.required, Validators.maxLength(100)]],
    usuarioRouter: ['', [Validators.required, Validators.maxLength(50)]],
    claveRouter: ['', [Validators.required, Validators.maxLength(100)]],
    interfaz: ['eth1', [Validators.required, Validators.maxLength(30)]],
  });

  /** Combina búsqueda libre y selectores sin modificar el arreglo temporal. */
  readonly serviciosFiltrados = computed(() => {
    const termino = this.normalizar(this.busqueda());
    const estado = this.estadoFiltro();
    const planId = this.planFiltro();
    return this.servicios().filter((servicio) => {
      const coincideTexto =
        !termino ||
        this.normalizar(
          `${servicio.codigo} ${servicio.cliente} ${servicio.ipv4} ${servicio.zona}`,
        ).includes(termino);
      return (
        coincideTexto &&
        (estado === 'Todos' || servicio.estado === estado) &&
        (!planId || servicio.planId === planId)
      );
    });
  });
  readonly totalActivos = computed(
    () => this.servicios().filter((servicio) => servicio.estado === 'Activo').length,
  );
  readonly totalPendientes = computed(
    () => this.servicios().filter((servicio) => servicio.estado === 'Pendiente').length,
  );

  actualizarBusqueda(evento: Event): void {
    const input = evento.target;
    if (input instanceof HTMLInputElement) this.busqueda.set(input.value);
  }

  actualizarEstado(evento: Event): void {
    const select = evento.target;
    if (select instanceof HTMLSelectElement) this.estadoFiltro.set(select.value as EstadoFiltro);
  }

  actualizarPlan(evento: Event): void {
    const select = evento.target;
    if (select instanceof HTMLSelectElement) this.planFiltro.set(Number(select.value));
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.estadoFiltro.set('Todos');
    this.planFiltro.set(0);
  }

  abrirNuevo(): void {
    this.editando.set(null);
    this.formulario.reset({
      clienteId: 0,
      planId: 0,
      fechaInicio: this.fechaActual(),
      estado: 'Pendiente',
      zona: '',
      descripcion: '',
      ipv4: '',
      mascara: '255.255.255.0',
      gateway: '',
      dnsPrimario: '8.8.8.8',
      dnsSecundario: '1.1.1.1',
      router: '',
      usuarioRouter: '',
      claveRouter: '',
      interfaz: 'eth1',
    });
    this.prepararAsistente();
  }

  /** Carga una copia del servicio y nunca expone credenciales ficticias guardadas. */
  abrirEdicion(servicio: ServicioInternetTemporal): void {
    this.editando.set(servicio);
    this.formulario.reset({
      clienteId: servicio.clienteId,
      planId: servicio.planId,
      fechaInicio: servicio.fechaInicio,
      estado: servicio.estado,
      zona: servicio.zona,
      descripcion: servicio.descripcion,
      ipv4: servicio.ipv4,
      mascara: servicio.mascara,
      gateway: servicio.gateway,
      dnsPrimario: servicio.dnsPrimario,
      dnsSecundario: servicio.dnsSecundario,
      router: servicio.router,
      usuarioRouter: servicio.usuarioRouter,
      claveRouter: '',
      interfaz: servicio.interfaz,
    });
    this.prepararAsistente();
  }

  cerrarFormulario(): void {
    if (!this.simulacionEnCurso()) this.formularioAbierto.set(false);
  }

  siguientePaso(): void {
    this.enviado.set(true);
    if (!this.pasoValido(this.paso())) return;
    this.enviado.set(false);
    this.paso.update((actual) => Math.min(actual + 1, 3));
  }

  pasoAnterior(): void {
    this.enviado.set(false);
    this.paso.update((actual) => Math.max(actual - 1, 1));
  }

  irAlPaso(numero: number): void {
    if (numero < this.paso()) {
      this.enviado.set(false);
      this.paso.set(numero);
    }
  }

  /** Simulación exclusivamente visual; no reserva direcciones en red ni base de datos. */
  async comprobarIp(): Promise<void> {
    const control = this.formulario.controls.ipv4;
    control.markAsTouched();
    if (control.invalid) return;
    this.resultadoIp.set('procesando');
    const disponible = await this.datosTemporales.simularDisponibilidadIp(
      control.value,
      this.editando()?.id,
    );
    this.resultadoIp.set(disponible ? 'correcto' : 'ocupada');
  }

  /** Simula la conexión y no utiliza las credenciales ingresadas contra EdgeOS. */
  async probarConexion(): Promise<void> {
    this.enviado.set(true);
    if (!this.pasoValido(3)) return;
    this.resultadoConexion.set('procesando');
    await this.datosTemporales.simularConexionEdge();
    this.resultadoConexion.set('correcto');
  }

  /** Simula la aplicación de reglas sin enviar comandos a ningún router. */
  async simularConfiguracion(): Promise<void> {
    this.enviado.set(true);
    if (!this.pasoValido(3) || this.resultadoConexion() !== 'correcto') return;
    this.resultadoConfiguracion.set('procesando');
    await this.datosTemporales.simularConfiguracionEdge();
    this.resultadoConfiguracion.set('correcto');
  }

  /** Guarda solo en memoria y descarta la clave temporal inmediatamente. */
  guardar(): void {
    this.enviado.set(true);
    if (this.formulario.invalid) {
      this.paso.set(this.primerPasoInvalido());
      return;
    }
    if (this.resultadoIp() === 'ocupada') {
      this.paso.set(2);
      return;
    }

    const valor = this.formulario.getRawValue();
    const payload: ServicioInternetPayload = {
      clienteId: valor.clienteId,
      planId: valor.planId,
      fechaInicio: valor.fechaInicio,
      estado: valor.estado,
      zona: valor.zona.trim(),
      descripcion: valor.descripcion.trim(),
      ipv4: valor.ipv4.trim(),
      mascara: valor.mascara.trim(),
      gateway: valor.gateway.trim(),
      dnsPrimario: valor.dnsPrimario.trim(),
      dnsSecundario: valor.dnsSecundario.trim(),
      router: valor.router.trim(),
      usuarioRouter: valor.usuarioRouter.trim(),
      interfaz: valor.interfaz.trim(),
    };
    const editando = this.editando();
    const guardado = this.datosTemporales.guardar(
      payload,
      editando?.id,
      this.resultadoConfiguracion() === 'correcto',
    );
    this.servicios.set(this.datosTemporales.listar());
    this.formulario.controls.claveRouter.reset('');
    this.formularioAbierto.set(false);
    this.aviso.set({
      titulo: editando ? 'Servicio actualizado' : 'Servicio registrado',
      mensaje: `${guardado.codigo} se guardó temporalmente en memoria. Los cambios desaparecerán al recargar la aplicación.`,
    });
  }

  clienteSeleccionado(): ClienteInternetTemporal | undefined {
    return this.clientes.find((cliente) => cliente.id === this.formulario.controls.clienteId.value);
  }

  planSeleccionado(): PlanInternetTemporal | undefined {
    return this.planes.find((plan) => plan.id === this.formulario.controls.planId.value);
  }

  formatoPlan(plan: PlanInternetTemporal): string {
    return `${plan.nombre} · ${plan.velocidad}`;
  }

  private prepararAsistente(): void {
    this.paso.set(1);
    this.enviado.set(false);
    this.resultadoIp.set('pendiente');
    this.resultadoConexion.set('pendiente');
    this.resultadoConfiguracion.set('pendiente');
    this.formularioAbierto.set(true);
  }

  private pasoValido(paso: number): boolean {
    const controles =
      paso === 1
        ? ['clienteId', 'planId', 'fechaInicio', 'estado', 'zona']
        : paso === 2
          ? ['ipv4', 'mascara', 'gateway', 'dnsPrimario', 'dnsSecundario']
          : ['router', 'usuarioRouter', 'claveRouter', 'interfaz'];
    controles.forEach((nombre) => this.formulario.get(nombre)?.markAsTouched());
    return controles.every((nombre) => this.formulario.get(nombre)?.valid);
  }

  private primerPasoInvalido(): number {
    if (!this.pasoValido(1)) return 1;
    if (!this.pasoValido(2)) return 2;
    return 3;
  }

  private simulacionEnCurso(): boolean {
    return [this.resultadoIp(), this.resultadoConexion(), this.resultadoConfiguracion()].includes(
      'procesando',
    );
  }

  private patronIpv4(): RegExp {
    return /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
  }

  private fechaActual(): string {
    const fecha = new Date();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
  }

  private normalizar(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
