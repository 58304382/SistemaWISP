// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

// ==========================================
// COMPONENTE DEL MODULO DE CLIENTES
// ==========================================
@Component({
  selector: 'app-clientes',
  imports: [RouterLink],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent {
  readonly auth = inject(AuthService);
}
