import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  ConfiguracionComprobanteInputDto,
  ConfiguracionComprobanteResponseDto,
} from '../models/comprobante-configuracion.models';

/** Servicio exclusivo de Mantenimiento → Factura / Comprobante. */
@Injectable({ providedIn: 'root' })
export class ComprobanteConfiguracionService {
  private readonly http = inject(HttpClient);

  getActiva(): Observable<ConfiguracionComprobanteResponseDto> {
    return this.http.get<ConfiguracionComprobanteResponseDto>(
      `${API_ENDPOINTS.configuracionComprobantes}/activa`,
    );
  }

  getUltima(): Observable<ConfiguracionComprobanteResponseDto> {
    return this.http.get<ConfiguracionComprobanteResponseDto>(
      `${API_ENDPOINTS.configuracionComprobantes}/ultima`,
    );
  }

  /** Guarda una versión nueva; el backend la activa y desactiva la anterior. */
  guardar(data: ConfiguracionComprobanteInputDto): Observable<ConfiguracionComprobanteResponseDto> {
    return this.http.post<ConfiguracionComprobanteResponseDto>(
      API_ENDPOINTS.configuracionComprobantes,
      data,
    );
  }
}
