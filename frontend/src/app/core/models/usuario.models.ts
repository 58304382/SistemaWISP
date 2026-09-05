// ==========================================
// MODELOS DE CATALOGO
// ==========================================
export interface Rol {
  id: number;
  nombre: 'Administrador' | 'Empleado' | string;
}

export interface Modulo {
  id: number;
  nombre: string;
  codigo: string;
  activo: boolean;
}

// ==========================================
// MODELO DE USUARIO
// ==========================================
export interface Usuario {
  id: number;
  nombre: string;
  apellido: string;
  username: string;
  rol_id: number;
  activo: boolean;
  created_at: string | null;
  updated_at: string | null;
  rol: Rol;
  modulos: Modulo[];
}

// ==========================================
// PAYLOADS DE USUARIO
// ==========================================
export interface UsuarioCreate {
  nombre: string;
  apellido: string;
  username: string;
  password: string;
  rol_id: number;
  activo: boolean;
  modulo_ids: number[];
}

export interface UsuarioUpdate {
  nombre?: string;
  apellido?: string;
  username?: string;
  password?: string;
  rol_id?: number;
  activo?: boolean;
  modulo_ids?: number[];
}

// ==========================================
// ROLES DISPONIBLES
// ==========================================
export const ROLES: Rol[] = [
  { id: 1, nombre: 'Administrador' },
  { id: 2, nombre: 'Empleado' },
];
