// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

// ==========================================
// COMPONENTE INICIO
// ==========================================
@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  templateUrl: './inicio.component.html',
  styleUrl: './inicio.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InicioComponent implements OnInit {
  // ==========================================
  // USUARIO AUTENTICADO
  // ==========================================
  readonly auth = inject(AuthService);
  readonly displayName = computed(() => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre} ${user.apellido}`.trim() : 'Usuario';
  });
  readonly initials = computed(() => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre.charAt(0)}${user.apellido.charAt(0)}`.toUpperCase() : 'U';
  });
  readonly canAccessPlanes = computed(
    () =>
      this.auth
        .currentUser()
        ?.modulos.some((modulo) => modulo.codigo === 'planes' && modulo.activo) ?? false,
  );

  // ==========================================
  // CARGA DE LA SESION ACTUAL
  // ==========================================
  ngOnInit(): void {
    if (this.auth.hasValidSession() && !this.auth.currentUser()) {
      this.auth.loadCurrentUser().subscribe({ error: () => undefined });
    }
  }
}
