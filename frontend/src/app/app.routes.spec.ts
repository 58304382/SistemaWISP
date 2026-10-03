import { moduleAccessGuard } from './core/guards/access.guard';
import { routes } from './app.routes';

describe('rutas de Mapas', () => {
  const children = routes.find((route) => route.path === '')?.children ?? [];

  it('protege /mapas con el permiso mapas', () => {
    const route = children.find((item) => item.path === 'mapas');

    expect(route?.data?.['module']).toBe('mapas');
    expect(route?.canActivate).toContain(moduleAccessGuard);
  });

  it('redirige la ruta histórica /clientes/mapa al módulo oficial', () => {
    const legacy = children.find((item) => item.path === 'clientes/mapa');

    expect(legacy?.redirectTo).toBe('/mapas');
    expect(legacy?.pathMatch).toBe('full');
  });
});
