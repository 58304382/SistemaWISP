import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { TicketDetalle } from '../../models/ticket.models';

/** Presentación única del detalle existente, compartida por Soporte y Tareas sin acciones de escritura. */
@Component({
  selector: 'app-ticket-detalle',
  imports: [DatePipe],
  templateUrl: './ticket-detalle.component.html',
  styleUrl: './ticket-detalle.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketDetalleComponent {
  @Input({ required: true }) ticket!: TicketDetalle;

  /** Resuelve únicamente evidencias del directorio de soporte servido por la API. */
  evidenceUrl(path: string | null): string | null {
    if (!path || !/^\/?uploads\/soporte_tecnico\/[A-Za-z0-9_-]+\.(webp|png|jpe?g)$/i.test(path)) return null;
    return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
  }
}
