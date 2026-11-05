import type { TipoInstalacion } from '../../visitas-tecnicas/models/visita-tecnica.models';

export type { TipoInstalacion };

export type EstadoTipoInstalacion = 'Activo' | 'Inactivo';

export interface TipoInstalacionCreate {
  nombre: string;
  descripcion: string | null;
  estado: EstadoTipoInstalacion;
}

export interface TipoInstalacionUpdate {
  nombre?: string;
  descripcion?: string | null;
  estado?: EstadoTipoInstalacion;
}
