export type EstadoServicioInternet = 'Activo' | 'Suspendido' | 'Pendiente';

export interface ClienteInternetTemporal {
  id: number;
  nombre: string;
  codigo: string;
  direccion: string;
}

export interface PlanInternetTemporal {
  id: number;
  nombre: string;
  velocidad: string;
  precio: number;
}

export interface ServicioInternetTemporal {
  id: number;
  codigo: string;
  clienteId: number;
  cliente: string;
  planId: number;
  plan: string;
  velocidad: string;
  precio: number;
  fechaInicio: string;
  estado: EstadoServicioInternet;
  zona: string;
  ipv4: string;
  mascara: string;
  gateway: string;
  dnsPrimario: string;
  dnsSecundario: string;
  router: string;
  usuarioRouter: string;
  interfaz: string;
  descripcion: string;
  edgeConfigurado: boolean;
}

export type ServicioInternetPayload = Omit<
  ServicioInternetTemporal,
  'id' | 'codigo' | 'cliente' | 'plan' | 'velocidad' | 'precio' | 'edgeConfigurado'
>;
