// ==========================================
// CONTRATO DE COORDENADAS DE LA API
// ==========================================
export interface CoordenadasApi {
  latitud: unknown;
  longitud: unknown;
}

export interface CoordenadasNormalizadas {
  latitud: number | null;
  longitud: number | null;
}

function normalizarCoordenada(
  valor: unknown,
  minimo: number,
  maximo: number,
  nombre: string,
): number | null {
  if (valor === null) {
    return null;
  }
  if (typeof valor !== 'number' && typeof valor !== 'string') {
    throw new Error(`La ${nombre} recibida no es numérica.`);
  }
  if (typeof valor === 'string' && !valor.trim()) {
    throw new Error(`La ${nombre} recibida no es numérica.`);
  }

  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero) || numero < minimo || numero > maximo) {
    throw new Error(`La ${nombre} recibida está fuera del rango permitido.`);
  }
  return numero;
}

/** Convierte el contrato JSON de FastAPI en coordenadas seguras para Google Maps. */
export function normalizarCoordenadas(
  coordenadas: CoordenadasApi,
  requeridas = false,
): CoordenadasNormalizadas {
  const latitud = normalizarCoordenada(coordenadas.latitud, -90, 90, 'latitud');
  const longitud = normalizarCoordenada(coordenadas.longitud, -180, 180, 'longitud');

  if ((latitud === null) !== (longitud === null)) {
    throw new Error('La latitud y la longitud recibidas deben estar completas.');
  }
  if (requeridas && latitud === null) {
    throw new Error('La latitud y la longitud son obligatorias.');
  }
  return { latitud, longitud };
}
