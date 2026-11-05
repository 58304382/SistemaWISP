import { API_ENDPOINTS } from '../../../core/config/api.config';
import type { TipoInstalacion } from './tipo-instalacion-catalogo.models';

export type CatalogoClave = 'instalacion' | 'trabajo' | 'tickets' | 'pagos' | 'caja' | 'puestos';

export interface CatalogoOpcion {
  clave: CatalogoClave;
  titulo: string;
  singular: string;
  endpoint: string;
  listado: string;
  campoId: string;
}

/** Se reutilizan las rutas de cada propietario funcional, sin crear otro backend global. */
export const CATALOGOS: readonly CatalogoOpcion[] = [
  { clave: 'instalacion', titulo: 'Tipos de instalación', singular: 'tipo de instalación', endpoint: API_ENDPOINTS.tiposInstalacion, listado: API_ENDPOINTS.tiposInstalacionTodos, campoId: 'id_tipo_instalacion' },
  { clave: 'trabajo', titulo: 'Tipos de trabajo', singular: 'tipo de trabajo', endpoint: API_ENDPOINTS.tiposTrabajo, listado: API_ENDPOINTS.tiposTrabajo, campoId: 'id_tipo_trabajo' },
  { clave: 'tickets', titulo: 'Categorías de tickets', singular: 'categoría de ticket', endpoint: API_ENDPOINTS.catalogoCategoriasTicket, listado: `${API_ENDPOINTS.catalogoCategoriasTicket}/todas`, campoId: 'id_categoria' },
  { clave: 'pagos', titulo: 'Métodos de pago', singular: 'método de pago', endpoint: API_ENDPOINTS.cobrosMetodosPago, listado: `${API_ENDPOINTS.cobrosMetodosPago}/todos`, campoId: 'id_metodo_pago' },
  { clave: 'caja', titulo: 'Categorías de caja', singular: 'categoría de caja', endpoint: API_ENDPOINTS.cajaCategorias, listado: `${API_ENDPOINTS.cajaCategorias}/todas`, campoId: 'id_categoria' },
  { clave: 'puestos', titulo: 'Puestos de empleado', singular: 'puesto de empleado', endpoint: API_ENDPOINTS.puestosEmpleado, listado: `${API_ENDPOINTS.puestosEmpleado}/todos`, campoId: 'id_puesto' },
];

/** Proyección visual compatible con el editor existente; el ID real no se envía como dato editable. */
export interface RegistroCatalogo extends TipoInstalacion {
  tipo?: 'Ingreso' | 'Egreso';
  origen_financiero?: string | null;
  tiene_funciones_sistema?: boolean;
}

export interface CatalogoPayload {
  nombre: string;
  descripcion: string | null;
  estado: 'Activo' | 'Inactivo';
  tipo?: 'Ingreso' | 'Egreso';
  tiene_funciones_sistema?: boolean;
}
