// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATALOGOS, CatalogoClave } from '../../models/catalogos.models';
import { TiposInstalacionComponent } from '../tipos-instalacion/tipos-instalacion.component';

// ==========================================
// COMPONENTE DE CATALOGOS DEL SISTEMA
// ==========================================
@Component({
  selector: 'app-catalogos',
  imports: [RouterLink, TiposInstalacionComponent],
  templateUrl: './catalogos.component.html',
  styleUrl: './catalogos.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogosComponent {
  readonly catalogos = CATALOGOS;
  readonly seleccionado = signal<CatalogoClave>('instalacion');
  readonly bloqueado = signal(false);

  /** Cambiar de catálogo solo reemplaza el panel, sin salir de esta pantalla. */
  seleccionar(clave: CatalogoClave): void {
    if (!this.bloqueado()) this.seleccionado.set(clave);
  }
}
