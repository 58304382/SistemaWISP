// ==========================================
// MODELOS DE ÓRDENES DE TRABAJO
// ==========================================
export type EstadoOrden = 'Programada' | 'En Proceso' | 'Completada';

export interface TipoTrabajo {
  id_tipo_trabajo: number;
  nombre: string;
  descripcion: string | null;
  estado: 'Activo' | 'Inactivo';
}

export interface TecnicoOrden {
  id_empleado: number;
  codigo: string;
  nombres: string;
  apellidos: string;
  nombre_puesto: string;
}

export interface EquipoOrden {
  id_equipo: number;
  id_orden: number;
  tipo_equipo: string;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  problema_reportado: string;
  accesorios_recibidos: string | null;
  estado_recepcion: string | null;
  observaciones: string | null;
}

export interface EquipoOrdenInput {
  tipo_equipo: string;
  marca?: string | null;
  modelo?: string | null;
  numero_serie?: string | null;
  problema_reportado: string;
  accesorios_recibidos?: string | null;
  estado_recepcion?: string | null;
  observaciones?: string | null;
}

export interface EvaluacionMaterialOrden {
  id_detalle: number;
  id_evaluacion: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

export interface EvaluacionMaterialOrdenInput {
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
}

export interface EvaluacionOrden {
  id_evaluacion: number;
  id_orden: number;
  fecha_evaluacion: string;
  diagnostico: string;
  trabajo_propuesto: string;
  observaciones: string | null;
  materiales: EvaluacionMaterialOrden[];
}

export interface EvaluacionOrdenRegistro {
  diagnostico: string;
  trabajo_propuesto: string;
  observaciones?: string | null;
  materiales?: EvaluacionMaterialOrdenInput[];
}

export interface FinalizacionOrdenRegistro {
  trabajo_realizado: string;
  resultado_solucion: string;
  observaciones_finales?: string | null;
  evidencia_ruta?: string | null;
}

export interface FinalizacionOrden {
  id_finalizacion: number;
  id_orden: number;
  trabajo_realizado: string;
  resultado_solucion: string;
  observaciones_finales: string | null;
  fecha_hora: string;
  evidencia_ruta: string | null;
}

export interface OrdenTrabajo {
  id_orden: number;
  codigo: string;
  id_cliente: number;
  nombre_cliente: string;
  id_tipo_trabajo: number;
  nombre_tipo_trabajo: string;
  id_empleado: number;
  nombre_tecnico: string;
  titulo: string;
  descripcion: string;
  fecha_recepcion: string;
  fecha_estimada: string | null;
  estado: EstadoOrden;
  fecha_inicio: string | null;
  equipo: EquipoOrden[];
  evaluacion: EvaluacionOrden | null;
  finalizacion: FinalizacionOrden | null;
  puede_editar: boolean;
  puede_eliminar: boolean;
  reparacion_autorizada: boolean;
  trabajo_rechazado: boolean;
  aprobacion_comercial_pendiente: boolean;
}

export interface OrdenTrabajoCreate {
  id_cliente: number;
  id_tipo_trabajo: number;
  id_empleado: number;
  titulo: string;
  descripcion: string;
  fecha_estimada?: string | null;
  equipo?: EquipoOrdenInput[];
}

export type OrdenTrabajoUpdate = Partial<OrdenTrabajoCreate>;