import { HttpErrorResponse } from '@angular/common/http';

import { getApiErrorMessage } from '../../core/utils/api-error';

describe('Errores HTTP de Cotizaciones', () => {
  it.each([
    [400, 'Regla comercial inválida', 'Regla comercial inválida'],
    [401, 'No autenticado', 'Tu sesión expiró'],
    [403, 'Sin acceso', 'No tienes permisos'],
    [404, 'Cotización inexistente', 'El recurso solicitado no existe'],
    [409, 'La cotización tiene dependencias', 'La cotización tiene dependencias'],
  ])('presenta un mensaje seguro para HTTP %i', (status, detail, esperado) => {
    const error = new HttpErrorResponse({ status, error: { detail } });

    expect(getApiErrorMessage(error)).toContain(esperado);
  });
});
