export interface UbicacionCliente {
  id_ubicacion: number;
  id_cliente: number;
  numero_propiedad: number;
  nombre_cliente: string;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  foto_fachada: string | null;
  referencia: string | null;
  observaciones: string | null;
  estado: 'Activo' | 'Inactivo';
  fecha_registro: string;
}

export interface PrimeraUbicacionVisitaCreate {
  direccion: string;
  referencia?: string;
  observaciones?: string;
  latitud?: number;
  longitud?: number;
}
