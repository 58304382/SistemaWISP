import { administratorGuard, moduleAccessGuard } from './core/guards/access.guard';
import { routes } from './app.routes';

describe('ruta del Dashboard Gerencial', () => {
  it('protege /dashboard con el permiso dashboard', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'dashboard');

    expect(route?.data?.['module']).toBe('dashboard');
    expect(route?.canActivate).toContain(moduleAccessGuard);
  });
});

describe('rutas de Mapas', () => {
  const children = routes.find((route) => route.path === '')?.children ?? [];

  it('protege /mapas con el permiso mapas', () => {
    const route = children.find((item) => item.path === 'mapas');

    expect(route?.data?.['module']).toBe('mapas');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('protege el mapa contextual de una visita con clientes sin cambiar /mapas', () => {
    const route = children.find((item) => item.path === 'tareas/visitas/:idVisita/mapa');

    expect(route?.data?.['module']).toBe('clientes');
    expect(route?.data?.['mapContext']).toBe('visita');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('protege el mapa contextual de instalación con el permiso del tablero', () => {
    const route = children.find((item) => item.path === 'tareas/instalaciones/:idInstalacion/mapa');

    expect(route?.data?.['module']).toBe('clientes');
    expect(route?.data?.['mapContext']).toBe('instalacion');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('redirige la ruta histórica /clientes/mapa al módulo oficial', () => {
    const legacy = children.find((item) => item.path === 'clientes/mapa');

    expect(legacy?.redirectTo).toBe('/mapas');
    expect(legacy?.pathMatch).toBe('full');
  });
});

describe('rutas de Finanzas', () => {
  const children = routes.find((route) => route.path === '')?.children ?? [];

  it('protege Finanzas con pagos, Cobros con sus categorías y Caja General con caja', () => {
    const finanzas = children.find((item) => item.path === 'finanzas');
    const cobros = children.find((item) => item.path === 'finanzas/cobros');
    const caja = children.find((item) => item.path === 'finanzas/caja-general');

    expect(finanzas?.data?.['module']).toBe('pagos');
    expect(finanzas?.canActivate).toContain(moduleAccessGuard);
    expect(cobros?.data?.['modules']).toEqual([
      'pagos_internet',
      'administrar_vencimientos_internet',
      'generar_mensualidades_internet',
      'pagos_instalaciones',
      'pagos_ordenes_trabajo',
    ]);
    expect(cobros?.canActivate).toContain(moduleAccessGuard);
    expect(cobros?.loadComponent).toBeDefined();
    expect(caja?.data?.['module']).toBe('caja');
    expect(caja?.canActivate).toContain(moduleAccessGuard);
  });
});

describe('rutas operativas de carga diferida', () => {
  it('mantiene Gestión de Instalaciones y Tareas fuera del bundle inicial', () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    const instalaciones = children.find((item) => item.path === 'instalaciones/gestion');
    const tareas = children.find((item) => item.path === 'tareas');

    expect(instalaciones?.loadComponent).toBeDefined();
    expect(instalaciones?.canActivate).toContain(moduleAccessGuard);
    expect(tareas?.loadComponent).toBeDefined();
    expect(tareas?.canActivate).toContain(moduleAccessGuard);
  });
});

// La asignación de tickets habilita Soporte sin ampliar permisos de otros módulos.
describe('ruta de Soporte Técnico', () => {
  it('exige el permiso tickets y carga su componente funcional', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'soporte-tecnico');
    expect(route?.data?.['module']).toBe('tickets');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });
});

describe('ruta de Proveedores', () => {
  it('exige el permiso proveedores y usa carga diferida', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'proveedores');
    expect(route?.data?.['module']).toBe('proveedores');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });
});

describe('rutas de Servicios', () => {
  const children = routes.find((route) => route.path === '')?.children ?? [];

  it('protege la pantalla principal con el permiso servicios', () => {
    const route = children.find((item) => item.path === 'servicios');

    expect(route?.data?.['module']).toBe('servicios');
    expect(route?.canActivate).toContain(moduleAccessGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('mantiene Internet pendiente y carga Asignación de Planes de forma independiente', () => {
    const internet = children.find((item) => item.path === 'servicios/internet');
    const mensualidades = children.find((item) => item.path === 'servicios/mensualidades');

    expect(internet?.data?.['module']).toBe('servicios');
    expect(internet?.data?.['title']).toBe('Servicios de Internet');
    expect(internet?.canActivate).toContain(moduleAccessGuard);
    expect(mensualidades?.data?.['module']).toBe('servicios');
    expect(mensualidades?.data?.['title']).toBe('Asignación de Planes');
    expect(mensualidades?.canActivate).toContain(moduleAccessGuard);
    expect(mensualidades?.loadComponent).toBeDefined();
  });
});

describe('ruta administrativa de Reportes', () => {
  it('carga la pantalla dentro de Configuración y exige Administrador', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'configuracion/reportes');

    expect(route?.canActivate).toContain(administratorGuard);
    expect(route?.loadComponent).toBeDefined();
  });
});

describe('ruta administrativa de Mantenimiento del Sistema', () => {
  it('carga la pantalla dentro de Configuración y exige Administrador', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'configuracion/mantenimiento');

    expect(route?.canActivate).toContain(administratorGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('protege el mantenimiento de documentos comerciales con Administrador', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find(
        (item) => item.path === 'configuracion/mantenimiento/documentos-comerciales',
      );

    expect(route?.canActivate).toContain(administratorGuard);
    expect(route?.loadComponent).toBeDefined();
  });

  it('protege Factura / Comprobante con Administrador y carga su pantalla', () => {
    const route = routes
      .find((item) => item.path === '')
      ?.children?.find((item) => item.path === 'configuracion/mantenimiento/factura-comprobante');

    expect(route?.canActivate).toContain(administratorGuard);
    expect(route?.loadComponent).toBeDefined();
  });
});

describe('rutas administrativas de Catálogos', () => {
  it('protege Catálogos y Tipos de instalación con Administrador', () => {
    const children = routes.find((item) => item.path === '')?.children ?? [];
    const catalogos = children.find(
      (item) => item.path === 'configuracion/mantenimiento/catalogos',
    );
    const tipos = children.find(
      (item) => item.path === 'configuracion/mantenimiento/catalogos/tipos-instalacion',
    );

    expect(catalogos?.canActivate).toContain(administratorGuard);
    expect(catalogos?.loadComponent).toBeDefined();
    expect(tipos?.canActivate).toContain(administratorGuard);
    expect(tipos?.loadComponent).toBeDefined();
  });
});
