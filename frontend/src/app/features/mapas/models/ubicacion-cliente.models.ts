import { CoordenadasApi, normalizarCoordenadas } from './coordenadas.models';

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

export type EstadoUbicacionCliente = UbicacionCliente['estado'];

/** Coordenadas explícitas devueltas al resolver un enlace de Google Maps. */
export interface GoogleMapsCoordinates {
  latitud: number;
  longitud: number;
}

/** Datos admitidos por el formulario administrativo de una propiedad nueva. */
export interface UbicacionClienteCreate {
  id_cliente: number;
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  referencia: string | null;
  observaciones: string | null;
  estado: EstadoUbicacionCliente;
}

/** Campos que FastAPI permite modificar sin alterar cliente ni numeración. */
export interface UbicacionClienteUpdate {
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
  referencia: string | null;
  observaciones: string | null;
  estado: EstadoUbicacionCliente;
}

export type UbicacionClienteApi = Omit<UbicacionCliente, 'latitud' | 'longitud'> & CoordenadasApi;

/** Normaliza una propiedad recibida antes de exponerla a componentes geográficos. */
export function normalizarUbicacionCliente(data: UbicacionClienteApi): UbicacionCliente {
  return { ...data, ...normalizarCoordenadas(data) };
}

export interface PrimeraUbicacionVisitaCreate {
  direccion: string;
  referencia?: string;
  observaciones?: string;
  latitud: number;
  longitud: number;
}
