import { CoordenadasApi, normalizarCoordenadas } from './coordenadas.models';

export type EstadoAntena = 'Activa' | 'Inactiva';

export interface Antena {
  id_antena: number;
  nombre: string;
  latitud: number;
  longitud: number;
  direccion_sector: string | null;
  referencia: string | null;
  foto_antena: string | null;
  estado: EstadoAntena;
}

/** Datos admitidos por el endpoint multipart de creación de antenas. */
export interface AntenaCreate {
  nombre: string;
  latitud: number;
  longitud: number;
  direccion_sector: string | null;
  referencia: string | null;
  estado: EstadoAntena;
}

/** Campos geográficos que el endpoint PATCH permite actualizar. */
export interface AntenaUpdate {
  direccion_sector: string | null;
  referencia: string | null;
  latitud: number;
  longitud: number;
}

export type AntenaApi = Omit<Antena, 'latitud' | 'longitud'> & CoordenadasApi;

/** Normaliza las coordenadas obligatorias de una antena recibida desde FastAPI. */
export function normalizarAntena(data: AntenaApi): Antena {
  const coordenadas = normalizarCoordenadas(data, true);
  return {
    ...data,
    latitud: coordenadas.latitud as number,
    longitud: coordenadas.longitud as number,
  };
}
