import { Departamento, Municipio } from '../../clientes/models/cliente.models';

export type EstadoProveedor = 'Activo' | 'Inactivo';

export interface Proveedor {
  id_proveedor: number;
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  id_municipio: number;
  estado: EstadoProveedor;
  observaciones: string | null;
  municipio: Municipio;
}

export interface ProveedorPayload {
  nombre: string;
  nit: string | null;
  contacto: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  id_municipio: number;
  estado: EstadoProveedor;
  observaciones: string | null;
}

export type { Departamento, Municipio };
