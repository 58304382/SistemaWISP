import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// Pantalla de entrada a las capacidades disponibles del módulo financiero.
@Component({
  selector: 'app-finanzas',
  imports: [RouterLink],
  templateUrl: './finanzas.component.html',
  styleUrl: './finanzas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanzasComponent {}
