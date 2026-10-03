// ==========================================
// MODELOS GEOGRAFICOS
// ==========================================
export type EstadoCatalogo = 'Activo' | 'Inactivo';

export interface Departamento {
  id_departamento: number;
  nombre: string;
  codigo: string | null;
  estado: EstadoCatalogo;
}

export interface Municipio {
  id_municipio: number;
  id_departamento: number;
  nombre: string;
  codigo_postal: string | null;
  estado: EstadoCatalogo;
}

// ==========================================
// MODELO DE CLIENTE
// ==========================================
export type EstadoCliente = 'Activo' | 'Inactivo';

export interface Cliente {
  id_cliente: number;
  id_municipio: number;
  nombres: string;
  apellidos: string;
  dpi: string | null;
  telefono: string;
  correo: string | null;
  direccion: string;
  referencia: string | null;
  estado: EstadoCliente;
  municipio: Municipio;
}

// ==========================================
// PAYLOADS DE CLIENTE
// ==========================================
export interface ClienteCreate {
  id_municipio: number;
  nombres: string;
  apellidos: string;
  dpi: string;
  telefono: string;
  correo: string | null;
  direccion: string;
  referencia?: string | null;
  estado: EstadoCliente;
}

export type ClienteUpdate = Partial<ClienteCreate>;
