import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from '../../../core/config/api.config';
import { CategoriaTicket, ClienteTicket, EstadoTicket, SoporteFinalizacion, TecnicoTicket, Ticket, TicketDetalle, TicketWrite } from '../models/ticket.models';

/** API administrativa; usa el interceptor JWT existente y el permiso tickets del backend. */
@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE_URL}/api/tickets`;

  /** Los filtros opcionales se envían como parámetros, sin construir SQL ni destinos externos. */
  getAll(filters: { buscar?: string; estado?: EstadoTicket; id_categoria?: number; id_tecnico?: number } = {}) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params = params.set(key, value);
    }
    return this.http.get<Ticket[]>(this.url, { params });
  }

  /** Consulta el detalle actual para Ver y valida nuevamente el estado antes de abrir Editar. */
  getById(id: number) { return this.http.get<TicketDetalle>(`${this.url}/${id}`); }

  /** Los selectores se autorizan en Soporte sin ampliar permisos de otros módulos. */
  getCategorias() { return this.http.get<CategoriaTicket[]>(`${this.url}/categorias`); }
  getClientes() { return this.http.get<ClienteTicket[]>(`${this.url}/clientes`); }
  getTecnicos() { return this.http.get<TecnicoTicket[]>(`${this.url}/tecnicos`); }

  /** Código, fecha y estado inicial se generan exclusivamente en el servidor. */
  create(data: TicketWrite) { return this.http.post<TicketDetalle>(this.url, data); }
  update(id: number, data: TicketWrite) { return this.http.put<TicketDetalle>(`${this.url}/${id}`, data); }

  /** El backend comprueba Programada y elimina ticket e historial en una transacción. */
  delete(id: number) { return this.http.delete<void>(`${this.url}/${id}`); }

  /** Ejecuta el ticket asignado; la API obtiene técnico y autor desde la sesión autenticada. */
  start(id: number) { return this.http.post<TicketDetalle>(`${this.url}/${id}/iniciar`, {}); }

  /** Reutiliza la API de tickets con multipart, sin enviar IDs laborales ni modificar el estado localmente. */
  complete(id: number, informe: SoporteFinalizacion, evidencia: File) {
    const data = new FormData();
    data.append('trabajo_realizado', informe.trabajo_realizado);
    data.append('resultado_solucion', informe.resultado_solucion);
    if (informe.observaciones) data.append('observaciones', informe.observaciones);
    data.append('evidencia', evidencia);
    return this.http.post<TicketDetalle>(`${this.url}/${id}/finalizar`, data);
  }
}
