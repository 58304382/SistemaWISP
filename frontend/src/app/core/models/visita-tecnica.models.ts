export type EstadoVisitaTecnica = 'Programada' | 'En Proceso' | 'Completada';

export interface TipoInstalacion {
  id_tipo_instalacion: number;
  nombre: string;
  descripcion: string | null;
  estado: 'Activo' | 'Inactivo';
}

export interface TecnicoVisita {
  id_empleado: number;
  codigo: string;
  nombres: string;
  apellidos: string;
  nombre_puesto: string;
}

export interface MaterialEvaluacionVisita {
  id_detalle: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

export interface EvaluacionVisita {
  id_evaluacion: number;
  id_visita: number;
  descripcion_trabajo: string;
  tecnicos_recomendados: number | null;
  condiciones_lugar: string | null;
  observacion_tecnica: string | null;
  materiales: MaterialEvaluacionVisita[];
}

export interface MaterialEvaluacionVisitaInput {
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
}

export interface EvaluacionVisitaPayload {
  descripcion_trabajo: string;
  tecnicos_recomendados: number | null;
  condiciones_lugar: string | null;
  observacion_tecnica: string | null;
  materiales: MaterialEvaluacionVisitaInput[];
}

export interface EvaluacionVisitaDraft {
  descripcion_trabajo?: string;
  tecnicos_recomendados?: number | null;
  condiciones_lugar?: string | null;
  observacion_tecnica?: string | null;
  materiales?: MaterialEvaluacionVisitaInput[];
}

export interface VisitaTecnica {
  id_visita: number;
  id_cliente: number;
  id_ubicacion: number | null;
  numero_propiedad: number | null;
  nombre_cliente: string;
  telefono_cliente: string;
  direccion_cliente: string;
  id_empleado: number;
  nombre_tecnico: string;
  id_tipo_instalacion: number;
  nombre_tipo_instalacion: string;
  fecha_programada: string;
  hora_programada: string;
  motivo_visita: string;
  foto_referencia: string | null;
  indicaciones: string | null;
  observaciones: string | null;
  estado: EstadoVisitaTecnica;
  evaluacion: EvaluacionVisita | null;
}

export interface VisitaTecnicaCreate {
  id_cliente: number;
  id_ubicacion: number | null;
  id_empleado: number;
  id_tipo_instalacion: number;
  fecha_programada: string;
  hora_programada: string;
  motivo_visita: string;
  indicaciones?: string;
  observaciones?: string;
}

export type VisitaTecnicaUpdate = Omit<
  Partial<VisitaTecnicaCreate>,
  'indicaciones' | 'observaciones'
> & {
  indicaciones?: string | null;
  observaciones?: string | null;
};
