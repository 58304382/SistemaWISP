import type { EvaluacionVisita } from '../../visitas-tecnicas/models/visita-tecnica.models';

export type EstadoInstalacion = 'Programada' | 'En Proceso' | 'Completada';

// Proyección de las relaciones existentes; no se guardan copias de los accesorios.
export interface VisitaProgramable {
  id_visita: number;
  id_ubicacion: number | null;
  id_cotizacion: number;
  numero_cotizacion: string;
  descripcion_trabajo: string;
  materiales: EvaluacionVisita['materiales'];
}

export interface ClienteInstalacion {
  id_cliente: number;
  nombre: string;
  telefono: string;
  direccion: string;
  municipio: string;
  dpi?: string | null;
  correo?: string | null;
  referencia?: string | null;
  estado?: string | null;
}

export interface TecnicoInstalacion {
  id_empleado: number;
  codigo: string;
  nombres: string;
  apellidos: string;
  id_puesto: number;
  nombre_puesto: string;
  estado: string;
  es_encargado: boolean;
}

export interface VisitaInstalacion {
  id_visita: number;
  id_tipo_instalacion: number;
  tipo_instalacion: string;
  descripcion_evaluacion: string | null;
  materiales?: EvaluacionVisita['materiales'];
  // Complemento de lectura de la visita y evaluación originales.
  fecha_programada?: string | null;
  hora_programada?: string | null;
  estado?: string | null;
  motivo_visita?: string | null;
  indicaciones?: string | null;
  observaciones?: string | null;
  nombre_tecnico?: string | null;
  foto_referencia?: string | null;
  id_evaluacion?: number | null;
  tecnicos_recomendados?: number | null;
  condiciones_lugar?: string | null;
  observacion_tecnica?: string | null;
}

export interface UbicacionInstalacion {
  id_ubicacion: number;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  referencia: string | null;
  observaciones: string | null;
  numero_propiedad?: number | null;
  foto_fachada?: string | null;
  estado?: string | null;
}

export interface Instalacion {
  id_instalacion: number;
  id_cliente: number;
  id_visita: number | null;
  id_ubicacion: number | null;
  fecha_programada: string;
  hora_programada: string;
  observaciones: string | null;
  estado: EstadoInstalacion;
  observaciones_tecnicas: string | null;
  fecha_finalizacion: string | null;
  evidencia_fotografica: string | null;
  fecha_registro: string;
  cliente: ClienteInstalacion;
  visita: VisitaInstalacion | null;
  ubicacion: UbicacionInstalacion | null;
  tecnicos: TecnicoInstalacion[];
  encargado: TecnicoInstalacion;
}

export interface TecnicoAsignacion {
  id_empleado: number;
  es_encargado: boolean;
}

export interface InstalacionCreate {
  id_cliente: number;
  id_visita?: number | null;
  id_ubicacion?: number | null;
  fecha_programada: string;
  hora_programada: string;
  observaciones?: string | null;
  tecnicos: TecnicoAsignacion[];
}

export interface InstalacionUpdate {
  id_cliente?: number;
  id_visita?: number | null;
  id_ubicacion?: number | null;
  fecha_programada?: string;
  hora_programada?: string;
  observaciones?: string | null;
  tecnicos?: TecnicoAsignacion[];
}
