import { Injectable, signal } from '@angular/core';

import {
  ClienteInternetTemporal,
  PlanInternetTemporal,
  ServicioInternetPayload,
  ServicioInternetTemporal,
} from '../models/servicio-internet.models';

// ==========================================
// DATOS TEMPORALES DE DEMOSTRACION
// Eliminar este bloque completo al integrar la API real.
// ==========================================
const CLIENTES_TEMPORALES: ClienteInternetTemporal[] = [
  { id: 1, nombre: 'Ana López', codigo: 'CLI-0018', direccion: 'Zona 1, San Pedro' },
  { id: 2, nombre: 'Carlos Méndez', codigo: 'CLI-0024', direccion: 'Aldea El Centro' },
  { id: 3, nombre: 'María García', codigo: 'CLI-0031', direccion: 'Barrio La Esperanza' },
  { id: 4, nombre: 'José Ramírez', codigo: 'CLI-0047', direccion: 'Colonia Las Flores' },
  { id: 5, nombre: 'Lucía Hernández', codigo: 'CLI-0052', direccion: 'Zona 3, San Pedro' },
];

const PLANES_TEMPORALES: PlanInternetTemporal[] = [
  { id: 1, nombre: 'Residencial Básico', velocidad: '10 Mbps', precio: 150 },
  { id: 2, nombre: 'Residencial Plus', velocidad: '20 Mbps', precio: 225 },
  { id: 3, nombre: 'Hogar Pro', velocidad: '30 Mbps', precio: 300 },
  { id: 4, nombre: 'Empresarial', velocidad: '50 Mbps', precio: 475 },
];

const SERVICIOS_TEMPORALES: ServicioInternetTemporal[] = [
  {
    id: 1,
    codigo: 'SVC-00128',
    clienteId: 1,
    cliente: 'Ana López',
    planId: 2,
    plan: 'Residencial Plus',
    velocidad: '20 Mbps',
    precio: 225,
    fechaInicio: '2026-08-12',
    estado: 'Activo',
    zona: 'San Pedro',
    ipv4: '10.20.1.18',
    mascara: '255.255.255.0',
    gateway: '10.20.1.1',
    dnsPrimario: '8.8.8.8',
    dnsSecundario: '1.1.1.1',
    router: 'edge-san-pedro',
    usuarioRouter: 'operador',
    interfaz: 'eth1',
    descripcion: 'Servicio residencial.',
    edgeConfigurado: true,
  },
  {
    id: 2,
    codigo: 'SVC-00129',
    clienteId: 2,
    cliente: 'Carlos Méndez',
    planId: 1,
    plan: 'Residencial Básico',
    velocidad: '10 Mbps',
    precio: 150,
    fechaInicio: '2026-09-03',
    estado: 'Pendiente',
    zona: 'El Centro',
    ipv4: '10.20.2.34',
    mascara: '255.255.255.0',
    gateway: '10.20.2.1',
    dnsPrimario: '8.8.8.8',
    dnsSecundario: '1.1.1.1',
    router: 'edge-centro',
    usuarioRouter: 'operador',
    interfaz: 'eth2',
    descripcion: 'Pendiente de activación.',
    edgeConfigurado: false,
  },
  {
    id: 3,
    codigo: 'SVC-00130',
    clienteId: 3,
    cliente: 'María García',
    planId: 3,
    plan: 'Hogar Pro',
    velocidad: '30 Mbps',
    precio: 300,
    fechaInicio: '2026-07-20',
    estado: 'Suspendido',
    zona: 'La Esperanza',
    ipv4: '10.20.3.12',
    mascara: '255.255.255.0',
    gateway: '10.20.3.1',
    dnsPrimario: '8.8.8.8',
    dnsSecundario: '1.1.1.1',
    router: 'edge-esperanza',
    usuarioRouter: 'operador',
    interfaz: 'eth3',
    descripcion: 'Suspensión administrativa.',
    edgeConfigurado: true,
  },
];

@Injectable({ providedIn: 'root' })
export class ServiciosInternetTemporalService {
  private readonly registros = signal<ServicioInternetTemporal[]>(SERVICIOS_TEMPORALES);

  /** Entrega copias para impedir que el formulario altere el estado sin guardar. */
  listar(): ServicioInternetTemporal[] {
    return this.registros().map((servicio) => ({ ...servicio }));
  }

  listarClientes(): ClienteInternetTemporal[] {
    return CLIENTES_TEMPORALES.map((cliente) => ({ ...cliente }));
  }

  listarPlanes(): PlanInternetTemporal[] {
    return PLANES_TEMPORALES.map((plan) => ({ ...plan }));
  }

  /** Crea o actualiza únicamente el arreglo volátil de esta sesión. */
  guardar(
    payload: ServicioInternetPayload,
    id?: number,
    configuracionDemostrativa = false,
  ): ServicioInternetTemporal {
    const cliente = CLIENTES_TEMPORALES.find((item) => item.id === payload.clienteId);
    const plan = PLANES_TEMPORALES.find((item) => item.id === payload.planId);
    if (!cliente || !plan) throw new Error('Cliente o plan temporal no disponible.');

    const existente = id ? this.registros().find((item) => item.id === id) : undefined;
    const siguienteId = existente
      ? existente.id
      : Math.max(...this.registros().map((item) => item.id)) + 1;
    const guardado: ServicioInternetTemporal = {
      ...payload,
      id: siguienteId,
      codigo: existente?.codigo ?? `SVC-${String(130 + siguienteId).padStart(5, '0')}`,
      cliente: cliente.nombre,
      plan: plan.nombre,
      velocidad: plan.velocidad,
      precio: plan.precio,
      edgeConfigurado: configuracionDemostrativa || existente?.edgeConfigurado || false,
    };

    this.registros.update((items) =>
      existente
        ? items.map((item) => (item.id === existente.id ? guardado : item))
        : [guardado, ...items],
    );
    return { ...guardado };
  }

  /** Simula latencia y disponibilidad sin consultar equipos ni servicios externos. */
  async simularDisponibilidadIp(ipv4: string, idActual?: number): Promise<boolean> {
    await this.esperarDemostracion();
    return !this.registros().some((item) => item.ipv4 === ipv4 && item.id !== idActual);
  }

  async simularConexionEdge(): Promise<boolean> {
    await this.esperarDemostracion();
    return true;
  }

  async simularConfiguracionEdge(): Promise<boolean> {
    await this.esperarDemostracion();
    return true;
  }

  private esperarDemostracion(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 650));
  }
}
