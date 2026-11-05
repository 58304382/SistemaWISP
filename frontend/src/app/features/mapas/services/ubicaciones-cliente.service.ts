import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  GoogleMapsCoordinates,
  UbicacionCliente,
  UbicacionClienteApi,
  UbicacionClienteCreate,
  UbicacionClienteUpdate,
  normalizarUbicacionCliente,
} from '../models/ubicacion-cliente.models';

@Injectable({ providedIn: 'root' })
export class UbicacionesClienteService {
  private readonly http = inject(HttpClient);

  /** Reutiliza el listado protegido de propiedades del cliente. */
  getByClient(idCliente: number): Observable<UbicacionCliente[]> {
    return this.http
      .get<UbicacionClienteApi[]>(`${API_ENDPOINTS.ubicacionesCliente}/cliente/${idCliente}`)
      .pipe(map((locations) => locations.map(normalizarUbicacionCliente)));
  }

  /** Obtiene una propiedad concreta para no exponer las demás en flujos contextuales. */
  getById(idUbicacion: number): Observable<UbicacionCliente> {
    return this.http
      .get<UbicacionClienteApi>(`${API_ENDPOINTS.ubicacionesCliente}/${idUbicacion}`)
      .pipe(map(normalizarUbicacionCliente));
  }

  /** Obtiene todas las propiedades una sola vez para el módulo Mapas. */
  getAll(): Observable<UbicacionCliente[]> {
    return this.http
      .get<UbicacionClienteApi[]>(API_ENDPOINTS.ubicacionesCliente)
      .pipe(map((locations) => locations.map(normalizarUbicacionCliente)));
  }

  /** Delega en FastAPI la resolución segura del enlace sin guardar la ubicación. */
  resolveGoogleMapsLink(enlace: string): Observable<GoogleMapsCoordinates> {
    return this.http.post<GoogleMapsCoordinates>(
      `${API_ENDPOINTS.ubicacionesCliente}/resolver-enlace-google-maps`,
      { enlace },
    );
  }

  /** Registra una propiedad; la numeración queda exclusivamente a cargo de FastAPI. */
  create(data: UbicacionClienteCreate, photo: File | null): Observable<UbicacionCliente> {
    const formData = new FormData();
    formData.append('id_cliente', String(data.id_cliente));
    this.appendOptional(formData, 'direccion', data.direccion);
    if (data.latitud !== null && data.longitud !== null) {
      formData.append('latitud', String(data.latitud));
      formData.append('longitud', String(data.longitud));
    }
    this.appendOptional(formData, 'referencia', data.referencia);
    this.appendOptional(formData, 'observaciones', data.observaciones);
    formData.append('estado', data.estado);
    if (photo) {
      formData.append('foto', photo, photo.name);
    }
    return this.http
      .post<UbicacionClienteApi>(API_ENDPOINTS.ubicacionesCliente, formData)
      .pipe(map(normalizarUbicacionCliente));
  }

  /** Actualiza únicamente los campos permitidos por el contrato PATCH. */
  update(idUbicacion: number, data: UbicacionClienteUpdate): Observable<UbicacionCliente> {
    return this.http
      .patch<UbicacionClienteApi>(`${API_ENDPOINTS.ubicacionesCliente}/${idUbicacion}`, data)
      .pipe(map(normalizarUbicacionCliente));
  }

  /** Elimina únicamente la propiedad indicada, sin afectar al cliente. */
  delete(idUbicacion: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.ubicacionesCliente}/${idUbicacion}`);
  }

  /** Reemplaza la fachada mediante el endpoint de archivos existente. */
  replacePhoto(idUbicacion: number, photo: File): Observable<UbicacionCliente> {
    const formData = new FormData();
    formData.append('foto', photo, photo.name);
    return this.http
      .put<UbicacionClienteApi>(`${API_ENDPOINTS.ubicacionesCliente}/${idUbicacion}/foto`, formData)
      .pipe(map(normalizarUbicacionCliente));
  }

  /** Quita la fachada sin modificar los demás datos de la propiedad. */
  removePhoto(idUbicacion: number): Observable<UbicacionCliente> {
    return this.http
      .delete<UbicacionClienteApi>(`${API_ENDPOINTS.ubicacionesCliente}/${idUbicacion}/foto`)
      .pipe(map(normalizarUbicacionCliente));
  }

  private appendOptional(formData: FormData, key: string, value: string | null): void {
    if (value) {
      formData.append(key, value);
    }
  }
}
