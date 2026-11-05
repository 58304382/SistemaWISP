// ==========================================
// IMPORTS
// ==========================================
import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { administratorGuard, moduleAccessGuard } from './core/guards/access.guard';
import { ClientesComponent } from './features/clientes/components/clientes/clientes.component';
import { GestionClientesComponent } from './features/clientes/components/gestion-clientes/gestion-clientes.component';
import { ConfiguracionComponent } from './features/configuracion/configuracion.component';
import { CotizacionFormComponent } from './features/cotizaciones/components/cotizacion-form/cotizacion-form.component';
import { DocumentoComercialComponent } from './features/cotizaciones/components/documento-comercial/documento-comercial.component';
import { LoginComponent } from './features/auth/login.component';
import { AppShellComponent } from './layout/app-shell.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { EmpleadosComponent } from './features/empleados/components/empleados/empleados.component';
import { FinanzasComponent } from './features/finanzas/components/finanzas/finanzas.component';
import { InicioComponent } from './features/inicio/inicio.component';
import { InstalacionesComponent } from './features/instalaciones/components/instalaciones/instalaciones.component';
import { VisitasTecnicasComponent } from './features/visitas-tecnicas/components/visitas-tecnicas/visitas-tecnicas.component';
import { PlanesComponent } from './features/planes/components/planes/planes.component';
import { UsuariosComponent } from './features/usuarios/components/usuarios/usuarios.component';

// Las tres rutas de mapas comparten la misma carga diferida para no duplicar su definición.
const loadMapasComponent = () =>
  import('./features/mapas/components/mapas/mapas.component').then(
    (module) => module.MapasComponent,
  );

// ==========================================
// RUTAS PUBLICAS Y PROTEGIDAS
// ==========================================
export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      { path: 'inicio', component: InicioComponent },
      {
        path: 'dashboard',
        component: DashboardComponent,
        canActivate: [moduleAccessGuard],
        // El Administrador conserva acceso; los demás requieren el permiso Dashboard.
        data: { module: 'dashboard' },
      },
      {
        path: 'clientes',
        component: ClientesComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'clientes/gestion',
        component: GestionClientesComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'instalaciones',
        component: InstalacionesComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'instalaciones/gestion',
        // Esta pantalla extensa se descarga únicamente después de validar su acceso.
        loadComponent: () =>
          import('./features/instalaciones/components/gestion-instalaciones/gestion-instalaciones.component').then(
            (module) => module.GestionInstalacionesComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: {
          module: 'clientes',
          title: 'Instalaciones',
          description: 'Consulta y organiza las instalaciones de la red.',
        },
      },
      {
        path: 'instalaciones/visitas-tecnicas',
        component: VisitasTecnicasComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'tareas',
        loadComponent: () =>
          import('./features/tareas/components/tareas/tareas.component').then(
            (module) => module.TareasComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'tareas/visitas/:idVisita/mapa',
        loadComponent: loadMapasComponent,
        canActivate: [moduleAccessGuard],
        // El acceso contextual no concede permisos sobre el módulo general de Mapas.
        data: { module: 'clientes', mapContext: 'visita' },
      },
      {
        path: 'tareas/instalaciones/:idInstalacion/mapa',
        loadComponent: loadMapasComponent,
        canActivate: [moduleAccessGuard],
        // Consulta contextual de la propiedad; conserva el permiso del tablero de tareas.
        data: { module: 'clientes', mapContext: 'instalacion' },
      },
      {
        path: 'clientes/mapa',
        pathMatch: 'full',
        redirectTo: '/mapas',
      },
      {
        path: 'mapas',
        loadComponent: loadMapasComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'mapas' },
      },
      {
        path: 'configuracion',
        component: ConfiguracionComponent,
        canActivate: [administratorGuard],
      },
      {
        path: 'soporte-tecnico',
        // Soporte usa el catálogo de permisos real, sin ampliar acceso a Clientes o Empleados.
        loadComponent: () =>
          import('./features/soporte-tecnico/components/soporte-tecnico/soporte-tecnico.component').then(
            (module) => module.SoporteTecnicoComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'tickets' },
      },
      {
        path: 'configuracion/empleados',
        component: EmpleadosComponent,
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/reportes',
        loadComponent: () =>
          import('./features/reportes/components/reportes/reportes.component').then(
            (module) => module.ReportesComponent,
          ),
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/mantenimiento',
        // Carga diferida de la pantalla de accesos de mantenimiento.
        loadComponent: () =>
          import('./features/mantenimiento/components/mantenimiento/mantenimiento.component').then(
            (module) => module.MantenimientoComponent,
          ),
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/mantenimiento/catalogos',
        loadComponent: () =>
          import('./features/mantenimiento/components/catalogos/catalogos.component').then(
            (module) => module.CatalogosComponent,
          ),
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/mantenimiento/catalogos/tipos-instalacion',
        // CRUD administrativo del catálogo existente; no crea tablas.
        loadComponent: () =>
          import('./features/mantenimiento/components/tipos-instalacion/tipos-instalacion.component').then(
            (module) => module.TiposInstalacionComponent,
          ),
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/mantenimiento/documentos-comerciales',
        loadComponent: () =>
          import('./features/cotizaciones/components/configuracion-documentos/configuracion-documentos.component').then(
            (module) => module.ConfiguracionDocumentosComponent,
          ),
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/mantenimiento/factura-comprobante',
        // Configuración exclusiva de los tickets térmicos de Cobros.
        loadComponent: () =>
          import('./features/finanzas/components/configuracion-comprobantes/configuracion-comprobantes.component').then(
            (module) => module.ConfiguracionComprobantesComponent,
          ),
        canActivate: [administratorGuard],
      },
      { path: 'usuarios', component: UsuariosComponent, canActivate: [administratorGuard] },
      {
        path: 'planes',
        component: PlanesComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'planes' },
      },
      {
        path: 'servicios',
        loadComponent: () =>
          import('./features/servicios/components/servicios/servicios.component').then(
            (module) => module.ServiciosComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'servicios' },
      },
      {
        path: 'servicios/internet',
        loadComponent: () =>
          import('./features/servicios/components/servicios-internet/servicios-internet.component').then(
            (module) => module.ServiciosInternetComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'servicios', title: 'Servicios de Internet' },
      },
      {
        path: 'servicios/mensualidades',
        loadComponent: () =>
          import('./features/servicios/components/asignacion-planes/asignacion-planes.component').then(
            (module) => module.AsignacionPlanesComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'servicios', title: 'Asignación de Planes' },
      },
      {
        path: 'proveedores',
        // Carga diferida para mantener el CRUD fuera del bundle inicial.
        loadComponent: () =>
          import('./features/proveedores/components/proveedores/proveedores.component').then(
            (module) => module.ProveedoresComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'proveedores' },
      },
      // El permiso "cotizaciones" ya forma parte del catálogo real de módulos.
      // Todas las vistas comparten el mismo control de acceso existente.
      {
        path: 'cotizaciones',
        // Carga diferida para no engrosar el bundle inicial, como caja-general.
        loadComponent: () =>
          import('./features/cotizaciones/components/cotizaciones/cotizaciones.component').then(
            (module) => module.CotizacionesComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones' },
      },
      {
        path: 'cotizaciones/nueva',
        component: CotizacionFormComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones' },
      },
      {
        path: 'cotizaciones/evaluacion/:idEvaluacion/nueva',
        component: CotizacionFormComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones' },
      },
      {
        path: 'cotizaciones/:id/editar',
        component: CotizacionFormComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones' },
      },
      {
        path: 'cotizaciones/:id/documento',
        component: DocumentoComercialComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones', tipoDocumento: 'COTIZACION' },
      },
      {
        path: 'cotizaciones/:id/proforma',
        component: DocumentoComercialComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'cotizaciones', tipoDocumento: 'PROFORMA' },
      },
      {
        path: 'finanzas',
        component: FinanzasComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'pagos' },
      },
      {
        path: 'finanzas/cobros',
        loadComponent: () =>
          import('./features/finanzas/components/cobros/cobros.component').then(
            (module) => module.CobrosComponent,
          ),
        canActivate: [moduleAccessGuard],
        // Cobros autoriza las mismas categorías hijas validadas por su API.
        data: {
          modules: [
            'pagos_internet',
            'administrar_vencimientos_internet',
            'generar_mensualidades_internet',
            'pagos_instalaciones',
            'pagos_ordenes_trabajo',
          ],
        },
      },
      {
        path: 'finanzas/caja-general',
        loadComponent: () =>
          import('./features/finanzas/components/caja-general/caja-general.component').then(
            (module) => module.CajaGeneralComponent,
          ),
        canActivate: [moduleAccessGuard],
        data: { module: 'caja' },
      },
      {
        path: 'ordenes-trabajo',
        // Carga diferida para no engrosar el bundle inicial, como caja-general.
        loadComponent: () =>
          import('./features/ordenes-trabajo/components/gestion-ordenes/gestion-ordenes.component').then(
            (module) => module.GestionOrdenesComponent,
          ),
        // El módulo es administrativo; el permiso se resuelve por rol y no por una
        // fila de modulos cuyo código aún no existe en el catálogo persistido.
        canActivate: [administratorGuard],
      },
    ],
  },
  { path: '**', redirectTo: 'inicio' },
];
