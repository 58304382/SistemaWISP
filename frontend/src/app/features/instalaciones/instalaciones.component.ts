import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// La landing comparte el patrón visual de Clientes para mantener consistencia sin duplicar CSS.
@Component({
  selector: 'app-instalaciones',
  imports: [RouterLink],
  templateUrl: './instalaciones.component.html',
  styleUrl: '../clientes/clientes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstalacionesComponent {}
