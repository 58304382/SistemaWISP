import type { EvaluacionVisita } from '../../visitas-tecnicas/models/visita-tecnica.models';

export type TipoTarea = 'Visita Técnica' | 'Instalación' | 'Orden de Trabajo' | 'Soporte Técnico';
export type EstadoTarea = 'Programada' | 'En Proceso' | 'Completada';

export interface TareaTecnico {
  id_empleado: number;
  codigo: string;
  nombre: string;
  es_encargado: boolean;
}

export interface Tarea {
  id: number;
  // Referencia a la fuente real de soporte; los demás tipos conservan sus identificadores.
  id_ticket?: number | null;
  codigo_ticket?: string | null;
  tipo: TipoTarea;
  id_visita: number | null;
  id_instalacion: number | null;
  id_cliente: number;
  id_ubicacion: number | null;
  numero_propiedad: number | null;
  direccion_propiedad: string | null;
  referencia_propiedad: string | null;
  foto_fachada: string | null;
  latitud: number | null;
  longitud: number | null;
  cliente: string;
  fecha: string;
  hora: string;
  descripcion: string | null;
  // Accesorios derivados de la evaluación, sin persistir otra copia.
  materiales?: EvaluacionVisita['materiales'];
  estado: EstadoTarea;
  id_tipo_instalacion: number | null;
  tipo_instalacion: string | null;
  tecnicos: TareaTecnico[];
  ubicacion_disponible: boolean;
  puede_ver: boolean;
  puede_realizar_acciones: boolean;
  es_responsable: boolean;
  bloqueada: boolean;
  // Solo órdenes de trabajo: true cuando la cotización fue ACEPTADA.
  reparacion_autorizada?: boolean;
  // Solo órdenes de trabajo: true cuando la cotización fue RECHAZADA.
  trabajo_rechazado?: boolean;
  // Etapa del proceso de la orden (sin evaluar / evaluada / finalizada).
  tiene_evaluacion?: boolean;
  tiene_finalizacion?: boolean;
  // Entrega habilitada por FastAPI con cotización COMPLETADA, incluido pendiente Q0.00.
  puede_finalizar_orden?: boolean;
  // Solo órdenes de trabajo: cotización vigente para registrar trabajo adicional.
  id_cotizacion?: number | null;
  // Cotización reabierta con Proforma previa: trabajo adicional en revisión.
  trabajo_adicional_en_revision?: boolean;
  // Cotización RECHAZADA con Proforma previa: rechazo solo del trabajo adicional.
  trabajo_adicional_rechazado?: boolean;
}
