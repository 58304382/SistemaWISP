// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// ==========================================
// COMPONENTE DE CONFIGURACION
// ==========================================
@Component({
  selector: 'app-configuracion',
  imports: [RouterLink],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionComponent {}
