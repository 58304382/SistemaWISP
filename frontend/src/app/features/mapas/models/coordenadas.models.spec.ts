import { normalizarCoordenadas } from './coordenadas.models';

describe('normalizarCoordenadas', () => {
  it('convierte strings decimales válidos a number', () => {
    expect(normalizarCoordenadas({ latitud: '14.6349000', longitud: '-90.5068000' })).toEqual({
      latitud: 14.6349,
      longitud: -90.5068,
    });
  });

  it('conserva null cuando ambas coordenadas son nulas', () => {
    expect(normalizarCoordenadas({ latitud: null, longitud: null })).toEqual({
      latitud: null,
      longitud: null,
    });
  });

  it.each([
    { latitud: '14.6', longitud: null },
    { latitud: null, longitud: '-90.5' },
  ])('rechaza pares incompletos: $latitud, $longitud', (coordinates) => {
    expect(() => normalizarCoordenadas(coordinates)).toThrow(
      'La latitud y la longitud recibidas deben estar completas.',
    );
  });

  it.each([
    { latitud: Number.NaN, longitud: -90.5 },
    { latitud: 14.6, longitud: Number.POSITIVE_INFINITY },
    { latitud: '91', longitud: '-90.5' },
    { latitud: '14.6', longitud: '-181' },
  ])('rechaza valores no finitos o fuera de rango', (coordinates) => {
    expect(() => normalizarCoordenadas(coordinates)).toThrow();
  });

  it('exige coordenadas para entidades con ubicación obligatoria', () => {
    expect(() => normalizarCoordenadas({ latitud: null, longitud: null }, true)).toThrow(
      'La latitud y la longitud son obligatorias.',
    );
  });
});
