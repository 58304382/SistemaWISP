export type EstadoInstalacion = 'Programada' | 'En Proceso' | 'Completada';

export interface ClienteInstalacion {
  id_cliente: number;
  nombre: string;
  telefono: string;
  direccion: string;
  municipio: string;
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
}

export interface UbicacionInstalacion {
  id_ubicacion: number;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  referencia: string | null;
  observaciones: string | null;
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
