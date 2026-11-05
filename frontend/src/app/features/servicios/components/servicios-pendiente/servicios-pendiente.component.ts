// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

// ==========================================
// DESTINO TEMPORAL DE LAS OPCIONES
// ==========================================
@Component({
  selector: 'app-servicios-pendiente',
  imports: [RouterLink],
  templateUrl: './servicios-pendiente.component.html',
  styleUrl: './servicios-pendiente.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiciosPendienteComponent {
  private readonly route = inject(ActivatedRoute);

  // El título proviene de la ruta para mantener independientes ambos destinos futuros.
  readonly title = this.route.snapshot.data['title'] as string;
}
