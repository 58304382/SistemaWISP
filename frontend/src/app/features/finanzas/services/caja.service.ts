import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  AperturaCajaCreate,
  ConciliacionCaja,
  EntregaEmpleado,
  EntregaEmpleadoCreate,
  CategoriaCaja,
  CierreCajaCreate,
  CierreCajaResponse,
  FiltrosMovimientosCaja,
  MovimientoCajaDetalle,
  MovimientoManualCajaCreate,
  MetodoPagoCaja,
  MovimientosCajaPage,
  SesionCajaActual,
} from '../models/caja.models';

// El interceptor global agrega el JWT; la identidad laboral nunca se recibe
// desde la interfaz y siempre se obtiene del usuario autenticado en FastAPI.
@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly http = inject(HttpClient);

  conciliacion(idSesion: number): Observable<ConciliacionCaja> {
    return this.http.get<ConciliacionCaja>(`${API_ENDPOINTS.cajaSesiones}/${idSesion}/conciliacion`);
  }

  registrarEntrega(data: EntregaEmpleadoCreate): Observable<EntregaEmpleado> {
    return this.http.post<EntregaEmpleado>(API_ENDPOINTS.cajaEntregas, data);
  }

  listarEntregas(idSesion: number, idEmpleado?: number): Observable<EntregaEmpleado[]> {
    let params = new HttpParams().set('id_sesion', idSesion);
    if (idEmpleado) params = params.set('id_empleado', idEmpleado);
    return this.http.get<EntregaEmpleado[]>(API_ENDPOINTS.cajaEntregas, { params });
  }

  detalleEntrega(id: number): Observable<EntregaEmpleado> {
    return this.http.get<EntregaEmpleado>(`${API_ENDPOINTS.cajaEntregas}/${id}`);
  }

  abrir(data: AperturaCajaCreate): Observable<SesionCajaActual> {
    return this.http.post<SesionCajaActual>(API_ENDPOINTS.cajaApertura, data);
  }

  // Identifica la sesión revisada para que un reintento no cierre otra jornada.
  // El interceptor conserva JWT y FastAPI valida al empleado de apertura.
  cerrar(idSesion: number, data: CierreCajaCreate): Observable<CierreCajaResponse> {
    return this.http.post<CierreCajaResponse>(
      `${API_ENDPOINTS.cajaSesiones}/${idSesion}/cierre`, data,
    );
  }

  obtenerSesionActual(): Observable<SesionCajaActual> {
    return this.http.get<SesionCajaActual>(API_ENDPOINTS.cajaSesionActual);
  }

  listarCategorias(tipo: CategoriaCaja['tipo']): Observable<CategoriaCaja[]> {
    const params = new HttpParams().set('tipo', tipo);
    return this.http.get<CategoriaCaja[]>(API_ENDPOINTS.cajaCategorias, { params });
  }

  listarMetodosPago(): Observable<MetodoPagoCaja[]> {
    return this.http.get<MetodoPagoCaja[]>(API_ENDPOINTS.cajaMetodosPago);
  }

  registrarMovimiento(data: MovimientoManualCajaCreate): Observable<MovimientoCajaDetalle> {
    return this.http.post<MovimientoCajaDetalle>(API_ENDPOINTS.cajaMovimientos, data);
  }

  listarMovimientos(filtros: FiltrosMovimientosCaja): Observable<MovimientosCajaPage> {
    let params = new HttpParams().set('page', filtros.page).set('page_size', filtros.page_size);

    const opcionales: Array<[string, string | number | undefined]> = [
      ['id_sesion', filtros.id_sesion],
      ['tipo', filtros.tipo],
      ['id_categoria', filtros.id_categoria],
      ['id_metodo_pago', filtros.id_metodo_pago],
      ['fecha_desde', filtros.fecha_desde],
      ['fecha_hasta', filtros.fecha_hasta],
    ];
    for (const [nombre, valor] of opcionales) {
      if (valor !== undefined && valor !== '') {
        params = params.set(nombre, valor);
      }
    }

    return this.http.get<MovimientosCajaPage>(API_ENDPOINTS.cajaMovimientos, { params });
  }
}
