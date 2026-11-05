/** Contratos reales de Soporte Técnico; el estado y el código los controla el backend. */
export type EstadoTicket = 'Programada' | 'En Proceso' | 'Completada';
export type CanalTicket = 'Llamada' | 'Presencial';

export interface CategoriaTicket {
  id_categoria: number;
  nombre: string;
  descripcion: string | null;
  estado: string;
}

export interface ClienteTicket {
  id_cliente: number;
  nombre: string;
  telefono: string;
}

export interface TecnicoTicket {
  id_empleado: number;
  nombres: string;
  apellidos: string;
  codigo: string;
}

/** Escritura administrativa: no admite cambios de estado ni un autor suministrado por la UI. */
export interface TicketWrite {
  id_cliente: number;
  id_categoria: number;
  id_tecnico: number;
  canal: CanalTicket;
  asunto: string;
  descripcion: string;
  observaciones: string | null;
}

export interface Ticket {
  id_ticket: number;
  codigo: string;
  id_cliente: number;
  cliente: string;
  telefono_cliente: string;
  id_categoria: number;
  categoria: string;
  id_tecnico: number | null;
  tecnico: string | null;
  canal: string;
  asunto: string;
  descripcion: string;
  observaciones: string | null;
  fecha_apertura: string;
  fecha_inicio: string | null;
  fecha_resolucion: string | null;
  estado: string;
}

/** Lectura del historial existente, incluidos informes ya disponibles sin habilitar su registro. */
export interface TicketHistorial {
  id_historial: number;
  id_usuario: number;
  usuario: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  accion: string;
  observacion: string | null;
  trabajo_realizado: string | null;
  resultado_solucion: string | null;
  evidencia_foto_ruta: string | null;
  fecha_hora: string;
}

export interface TicketDetalle extends Ticket {
  historial: TicketHistorial[];
}

/** Informe técnico multipart: la fotografía es obligatoria y no se sustituye por una ruta enviada. */
export interface SoporteFinalizacion {
  trabajo_realizado: string;
  resultado_solucion: string;
  observaciones: string | null;
}
