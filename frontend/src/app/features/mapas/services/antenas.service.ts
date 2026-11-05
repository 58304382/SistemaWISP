import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { API_ENDPOINTS } from '../../../core/config/api.config';
import {
  Antena,
  AntenaApi,
  AntenaCreate,
  AntenaUpdate,
  normalizarAntena,
} from '../models/antena.models';

@Injectable({ providedIn: 'root' })
export class AntenasService {
  private readonly http = inject(HttpClient);

  /** Carga una sola vez el catálogo que consumirá el mapa y sus filtros locales. */
  getAll(): Observable<Antena[]> {
    return this.http
      .get<AntenaApi[]>(API_ENDPOINTS.antenas)
      .pipe(map((antennas) => antennas.map(normalizarAntena)));
  }

  /** Recupera los datos actuales de la antena elegida antes de editarla. */
  getById(idAntena: number): Observable<Antena> {
    return this.http
      .get<AntenaApi>(`${API_ENDPOINTS.antenas}/${idAntena}`)
      .pipe(map(normalizarAntena));
  }

  /** Registra la antena y su fotografía opcional mediante el contrato multipart existente. */
  create(data: AntenaCreate, photo: File | null): Observable<Antena> {
    const formData = new FormData();
    formData.append('nombre', data.nombre);
    formData.append('latitud', String(data.latitud));
    formData.append('longitud', String(data.longitud));
    formData.append('estado', data.estado);
    this.appendOptional(formData, 'direccion_sector', data.direccion_sector);
    this.appendOptional(formData, 'referencia', data.referencia);
    if (photo) {
      formData.append('foto', photo, photo.name);
    }
    return this.http.post<AntenaApi>(API_ENDPOINTS.antenas, formData).pipe(map(normalizarAntena));
  }

  /** Actualiza solo ubicación, dirección y referencia; no altera datos técnicos. */
  update(idAntena: number, data: AntenaUpdate): Observable<Antena> {
    return this.http
      .patch<AntenaApi>(`${API_ENDPOINTS.antenas}/${idAntena}`, data)
      .pipe(map(normalizarAntena));
  }

  /** Elimina únicamente la antena indicada mediante el endpoint administrativo. */
  delete(idAntena: number): Observable<void> {
    return this.http.delete<void>(`${API_ENDPOINTS.antenas}/${idAntena}`);
  }

  /** Reemplaza la fotografía mediante el endpoint de archivos existente. */
  replacePhoto(idAntena: number, photo: File): Observable<Antena> {
    const formData = new FormData();
    formData.append('foto', photo, photo.name);
    return this.http
      .put<AntenaApi>(`${API_ENDPOINTS.antenas}/${idAntena}/foto`, formData)
      .pipe(map(normalizarAntena));
  }

  /** Quita la fotografía sin modificar los demás datos de la antena. */
  removePhoto(idAntena: number): Observable<Antena> {
    return this.http
      .delete<AntenaApi>(`${API_ENDPOINTS.antenas}/${idAntena}/foto`)
      .pipe(map(normalizarAntena));
  }

  private appendOptional(formData: FormData, key: string, value: string | null): void {
    if (value) {
      formData.append(key, value);
    }
  }
}
