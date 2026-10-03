// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../core/services/auth.service';

// ==========================================
// COMPONENTE Y ESTADO DEL SIDEBAR
// ==========================================
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  readonly clientsExpanded = signal(true);

  // ==========================================
  // INFORMACION DEL USUARIO AUTENTICADO
  // ==========================================
  readonly displayName = () => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre} ${user.apellido}`.trim() : 'Usuario';
  };

  readonly initials = () => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre.charAt(0)}${user.apellido.charAt(0)}`.toUpperCase() : 'U';
  };

  // ==========================================
  // METODOS DE NAVEGACION
  // ==========================================
  toggleClients(): void {
    this.clientsExpanded.update((expanded) => !expanded);
  }
}
