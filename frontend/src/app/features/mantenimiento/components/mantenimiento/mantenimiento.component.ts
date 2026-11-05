// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// ==========================================
// COMPONENTE DE MANTENIMIENTO DEL SISTEMA
// ==========================================
@Component({
  selector: 'app-mantenimiento',
  imports: [RouterLink],
  templateUrl: './mantenimiento.component.html',
  styleUrl: './mantenimiento.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MantenimientoComponent {}
