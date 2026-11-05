import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, reduce } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import { Cliente } from '../../clientes/models/cliente.models';
import {
  CobroSaldo,
  CobrosPage,
  ComprobantesPage,
  ComprobanteTicket,
  EmpleadoReceptorCobro,
  CotizacionInstalacionCobro,
  CotizacionOrdenCobro,
  DiaVencimientoServicioUpdate,
  DistribucionPagoCreate,
  GeneracionMensualidadesInternetCreate,
  GeneracionMensualidadesInternetResponse,
  MetodoPagoCobro,
  PagoConfirmado,
  PagosSaldoDisponiblePage,
  PagoSaldoDisponible,
  OrigenFinanciero,
  RegistroPagoCreate,
  RegistroPendienteCreate,
  ServicioInternetCobro,
} from '../models/cobros.models';

@Injectable({ providedIn: 'root' })
export class CobrosService {
  private readonly http = inject(HttpClient);

  listarEmpleadosReceptores(): Observable<EmpleadoReceptorCobro[]> {
    return this.http.get<EmpleadoReceptorCobro[]>(`${API_ENDPOINTS.cobros}/empleados-receptores`);
  }

  listar(page = 1, pageSize = 100): Observable<CobrosPage> {
    const params = new HttpParams().set('page', page).set('page_size', pageSize);
    return this.http.get<CobrosPage>(API_ENDPOINTS.cobros, { params });
  }

  listarTodos(): Observable<CobroSaldo[]> {
    return this.listar().pipe(
      expand((pagina) =>
        pagina.page < pagina.total_pages ? this.listar(pagina.page + 1, pagina.page_size) : EMPTY,
      ),
      reduce((items, pagina) => [...items, ...pagina.items], [] as CobroSaldo[]),
    );
  }

  listarMetodosPago(): Observable<MetodoPagoCobro[]> {
    return this.http.get<MetodoPagoCobro[]>(API_ENDPOINTS.cobrosMetodosPago);
  }

  listarClientesActivos(): Observable<Cliente[]> {
    return this.http.get<Cliente[]>(API_ENDPOINTS.cobrosClientes);
  }

  listarServiciosInternet(): Observable<ServicioInternetCobro[]> {
    return this.http.get<ServicioInternetCobro[]>(API_ENDPOINTS.cobrosServiciosInternet);
  }

  actualizarDiaVencimiento(
    idAsignacion: number,
    data: DiaVencimientoServicioUpdate,
  ): Observable<ServicioInternetCobro> {
    return this.http.patch<ServicioInternetCobro>(
      `${API_ENDPOINTS.cobrosServiciosInternet}/${idAsignacion}/dia-vencimiento`,
      data,
    );
  }

  generarMensualidadesInternet(
    data: GeneracionMensualidadesInternetCreate,
  ): Observable<GeneracionMensualidadesInternetResponse> {
    return this.http.post<GeneracionMensualidadesInternetResponse>(
      `${API_ENDPOINTS.cobros}/internet/mensualidades`,
      data,
    );
  }

  listarCotizacionesOrden(idCliente: number): Observable<CotizacionOrdenCobro[]> {
    const params = new HttpParams().set('id_cliente', idCliente);
    return this.http.get<CotizacionOrdenCobro[]>(API_ENDPOINTS.cobrosCotizacionesOrden, { params });
  }

  listarCotizacionesInstalacion(idCliente: number): Observable<CotizacionInstalacionCobro[]> {
    const params = new HttpParams().set('id_cliente', idCliente);
    return this.http.get<CotizacionInstalacionCobro[]>(
      API_ENDPOINTS.cobrosCotizacionesInstalacion,
      { params },
    );
  }

  registrarPago(data: RegistroPagoCreate): Observable<PagoConfirmado> {
    return this.http.post<PagoConfirmado>(API_ENDPOINTS.cobrosPagos, data);
  }

  // Reutiliza la obligación por cotización sin crear pagos ni ingresos en Caja.
  registrarPendiente(data: RegistroPendienteCreate): Observable<CobroSaldo> {
    return this.http.post<CobroSaldo>(`${API_ENDPOINTS.cobros}/obligaciones-pendientes`, data);
  }

  listarAnticipos(
    idCliente: number,
    origenFinanciero: OrigenFinanciero,
    page = 1,
    pageSize = 100,
  ): Observable<PagosSaldoDisponiblePage> {
    const params = new HttpParams()
      .set('id_cliente', idCliente)
      .set('origen_financiero', origenFinanciero)
      .set('page', page)
      .set('page_size', pageSize);
    return this.http.get<PagosSaldoDisponiblePage>(API_ENDPOINTS.cobrosPagos, { params });
  }

  listarTodosAnticipos(
    idCliente: number,
    origenFinanciero: OrigenFinanciero,
  ): Observable<PagoSaldoDisponible[]> {
    return this.listarAnticipos(idCliente, origenFinanciero).pipe(
      expand((pagina) =>
        pagina.page < pagina.total_pages
          ? this.listarAnticipos(idCliente, origenFinanciero, pagina.page + 1, pagina.page_size)
          : EMPTY,
      ),
      reduce((items, pagina) => [...items, ...pagina.items], [] as PagoSaldoDisponible[]),
    );
  }

  distribuirPago(idPago: number, data: DistribucionPagoCreate): Observable<PagoConfirmado> {
    return this.http.post<PagoConfirmado>(
      `${API_ENDPOINTS.cobrosPagos}/${idPago}/aplicaciones`,
      data,
    );
  }

  listarComprobantes(idCobro: number, page = 1, pageSize = 50): Observable<ComprobantesPage> {
    const params = new HttpParams()
      .set('id_cobro', idCobro)
      .set('page', page)
      .set('page_size', pageSize);
    return this.http.get<ComprobantesPage>(API_ENDPOINTS.cobrosComprobantes, { params });
  }

  consultarComprobante(idComprobante: number): Observable<ComprobanteTicket> {
    return this.http.get<ComprobanteTicket>(`${API_ENDPOINTS.cobrosComprobantes}/${idComprobante}`);
  }

  descargarComprobantePdf(idComprobante: number): Observable<Blob> {
    return this.http.get(`${API_ENDPOINTS.cobrosComprobantes}/${idComprobante}/pdf`, {
      responseType: 'blob',
    });
  }

  /** Descarga una copia térmica actual sin modificar el PDF histórico emitido. */
  descargarComprobantePdfTermico(idComprobante: number): Observable<Blob> {
    return this.http.get(`${API_ENDPOINTS.cobrosComprobantes}/${idComprobante}/pdf-termico`, {
      responseType: 'blob',
    });
  }
}
