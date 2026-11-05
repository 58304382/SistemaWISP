export type TipoPlan = 'ESTANDAR' | 'PERSONALIZADO';
export type EstadoPlan = 'Activo' | 'Inactivo';

export interface Plan {
  id: number;
  nombre: string;
  velocidad: string;
  precio_mensual: number;
  tipo_plan: TipoPlan;
  estado: EstadoPlan;
  descripcion: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PlanCreate {
  nombre: string;
  velocidad: string;
  precio_mensual: number;
  tipo_plan: TipoPlan;
  estado: EstadoPlan;
  descripcion: string | null;
}

export interface PlanUpdate {
  nombre?: string;
  velocidad?: string;
  precio_mensual?: number;
  estado?: EstadoPlan;
  descripcion?: string | null;
}
