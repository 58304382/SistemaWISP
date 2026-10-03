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
