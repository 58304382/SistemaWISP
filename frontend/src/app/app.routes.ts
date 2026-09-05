import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { InicioComponent } from './features/inicio/inicio.component';
import { LoginComponent } from './features/auth/login.component';
import { UsuariosComponent } from './features/usuarios/usuarios.component';
import { PlanesComponent } from './features/planes/planes.component';
import { planesGuard } from './core/guards/planes.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'inicio', component: InicioComponent, canActivate: [authGuard] },
  { path: 'usuarios', component: UsuariosComponent, canActivate: [authGuard] },
  { path: 'planes', component: PlanesComponent, canActivate: [authGuard, planesGuard] },
  { path: '**', redirectTo: 'usuarios' },
];
