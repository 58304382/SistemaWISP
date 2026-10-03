// ==========================================
// IMPORTS
// ==========================================
import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { administratorGuard, moduleAccessGuard } from './core/guards/access.guard';
import { ClientesComponent } from './features/clientes/clientes.component';
import { GestionClientesComponent } from './features/clientes/gestion-clientes.component';
import { ClientesVistaComponent } from './features/clientes/clientes-vista.component';
import { ConfiguracionComponent } from './features/configuracion/configuracion.component';
import { CotizacionFormComponent } from './features/cotizaciones/cotizacion-form.component';
import { CotizacionesComponent } from './features/cotizaciones/cotizaciones.component';
import { DocumentoComercialComponent } from './features/cotizaciones/documento-comercial.component';
import { LoginComponent } from './features/auth/login.component';
import { AppShellComponent } from './layout/app-shell.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { EmpleadosComponent } from './features/empleados/empleados.component';
import { InicioComponent } from './features/inicio/inicio.component';
import { InstalacionesComponent } from './features/instalaciones/instalaciones.component';
import { MapasComponent } from './features/mapas/mapas.component';
import { VisitasTecnicasComponent } from './features/instalaciones/visitas-tecnicas.component';
import { PlanesComponent } from './features/planes/planes.component';
import { TareasComponent } from './features/tareas/tareas.component';
import { UsuariosComponent } from './features/usuarios/usuarios.component';

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
      { path: 'dashboard', component: DashboardComponent },
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
        component: ClientesVistaComponent,
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
        component: TareasComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'clientes' },
      },
      {
        path: 'clientes/mapa',
        pathMatch: 'full',
        redirectTo: '/mapas',
      },
      {
        path: 'mapas',
        component: MapasComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'mapas' },
      },
      {
        path: 'configuracion',
        component: ConfiguracionComponent,
        canActivate: [administratorGuard],
      },
      {
        path: 'configuracion/empleados',
        component: EmpleadosComponent,
        canActivate: [administratorGuard],
      },
      { path: 'usuarios', component: UsuariosComponent, canActivate: [administratorGuard] },
      {
        path: 'planes',
        component: PlanesComponent,
        canActivate: [moduleAccessGuard],
        data: { module: 'planes' },
      },
      // El permiso "cotizaciones" ya forma parte del catálogo real de módulos.
      // Todas las vistas comparten el mismo control de acceso existente.
      {
        path: 'cotizaciones',
        component: CotizacionesComponent,
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
    ],
  },
  { path: '**', redirectTo: 'inicio' },
];
