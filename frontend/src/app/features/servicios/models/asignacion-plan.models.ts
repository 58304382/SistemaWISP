export type EstadoAsignacionPlan = 'Activo' | 'Inactivo';

export interface ClienteAsignacionCatalogo {
  id_cliente: number;
  nombres: string;
  apellidos: string;
  estado: string;
}

export interface PlanAsignacionCatalogo {
  id: number;
  nombre: string;
  velocidad: string;
  precio_mensual: number;
  estado: string;
}

export interface AsignacionPlan {
  id_asignacion: number;
  id_cliente: number;
  id_plan: number;
  costo_mensual: number;
  fecha_inicio: string;
  estado: EstadoAsignacionPlan;
  fecha_creacion: string;
  fecha_actualizacion: string | null;
  cliente: ClienteAsignacionCatalogo;
  plan: PlanAsignacionCatalogo;
}

/** El precio no forma parte del payload: FastAPI lo copia del plan activo. */
export interface AsignacionPlanPayload {
  id_cliente: number;
  id_plan: number;
  fecha_inicio: string;
  estado: EstadoAsignacionPlan;
}
