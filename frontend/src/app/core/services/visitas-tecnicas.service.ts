import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { PrimeraUbicacionVisitaCreate, UbicacionCliente } from '../models/ubicacion-cliente.models';
import {
  EvaluacionVisita,
  EvaluacionVisitaDraft,
  EvaluacionVisitaPayload,
  EstadoVisitaTecnica,
  TecnicoVisita,
  TipoInstalacion,
  VisitaTecnica,
  VisitaTecnicaCreate,
  VisitaTecnicaUpdate,
} from '../models/visita-tecnica.models';

@Injectable({ providedIn: 'root' })
export class VisitasTecnicasService {
  private readonly http = inject(HttpClient);

  getTiposInstalacion(): Observable<TipoInstalacion[]> {
    return this.http.get<TipoInstalacion[]>(API_ENDPOINTS.tiposInstalacion);
  }

  getTecnicos(): Observable<TecnicoVisita[]> {
    return this.http.get<TecnicoVisita[]>(`${API_ENDPOINTS.visitasTecnicas}/tecnicos`);
  }

  getAll(estado?: EstadoVisitaTecnica): Observable<VisitaTecnica[]> {
    const options = estado ? { params: new HttpParams().set('estado', estado) } : {};
    return this.http.get<VisitaTecnica[]>(API_ENDPOINTS.visitasTecnicas, options);
  }

  getById(idVisita: number): Observable<VisitaTecnica> {
    return this.http.get<VisitaTecnica>(`${API_ENDPOINTS.visitasTecnicas}/${idVisita}`);
  }

  create(data: VisitaTecnicaCreate, photo?: File): Observable<VisitaTecnica> {
    // FastAPI recibe el alta como multipart, incluidos los IDs reales y el archivo opcional.
    const formData = this.toFormData(data);
    if (photo) {
      formData.append('foto_referencia', photo, photo.name);
    }
    return this.http.post<VisitaTecnica>(API_ENDPOINTS.visitasTecnicas, formData);
  }

  update(idVisita: number, data: VisitaTecnicaUpdate): Observable<VisitaTecnica> {
    return this.http.patch<VisitaTecnica>(`${API_ENDPOINTS.visitasTecnicas}/${idVisita}`, data);
  }

  deleteById(idVisita: number): Observable<VisitaTecnica> {
    return this.http.delete<VisitaTecnica>(`${API_ENDPOINTS.visitasTecnicas}/${idVisita}`);
  }

  replacePhoto(idVisita: number, photo: File): Observable<VisitaTecnica> {
    const formData = new FormData();
    formData.append('foto_referencia', photo, photo.name);
    return this.http.put<VisitaTecnica>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/foto-referencia`,
      formData,
    );
  }

  removePhoto(idVisita: number): Observable<VisitaTecnica> {
    return this.http.delete<VisitaTecnica>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/foto-referencia`,
    );
  }

  /** Registra y vincula atómicamente la primera propiedad de una visita. */
  registerFirstLocation(
    idVisita: number,
    data: PrimeraUbicacionVisitaCreate,
    facadePhoto?: File,
  ): Observable<UbicacionCliente> {
    const formData = new FormData();
    formData.append('direccion', data.direccion);
    if (data.referencia) {
      formData.append('referencia', data.referencia);
    }
    if (data.observaciones) {
      formData.append('observaciones', data.observaciones);
    }
    if (data.latitud !== undefined && data.longitud !== undefined) {
      formData.append('latitud', String(data.latitud));
      formData.append('longitud', String(data.longitud));
    }
    if (facadePhoto) {
      formData.append('foto_fachada', facadePhoto, facadePhoto.name);
    }
    return this.http.post<UbicacionCliente>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/ubicacion`,
      formData,
    );
  }

  /** Inicia la única evaluación asociada a una visita Programada. */
  startEvaluation(idVisita: number, data: EvaluacionVisitaPayload): Observable<VisitaTecnica> {
    return this.http.post<VisitaTecnica>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/evaluacion`,
      data,
    );
  }

  /** Recupera la evaluación existente para continuarla o mostrarla en solo lectura. */
  getEvaluation(idVisita: number): Observable<EvaluacionVisita> {
    return this.http.get<EvaluacionVisita>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/evaluacion`,
    );
  }

  /** Actualiza el borrador existente sin crear una segunda evaluación. */
  updateEvaluation(idVisita: number, data: EvaluacionVisitaDraft): Observable<VisitaTecnica> {
    return this.http.patch<VisitaTecnica>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/evaluacion`,
      data,
    );
  }

  /** Finaliza una evaluación existente y devuelve la visita con su nuevo estado. */
  finishEvaluation(idVisita: number, data: EvaluacionVisitaPayload): Observable<VisitaTecnica> {
    return this.http.post<VisitaTecnica>(
      `${API_ENDPOINTS.visitasTecnicas}/${idVisita}/evaluacion/finalizar`,
      data,
    );
  }

  private toFormData(data: VisitaTecnicaCreate): FormData {
    const formData = new FormData();
    formData.append('id_cliente', String(data.id_cliente));
    if (data.id_ubicacion !== null) {
      formData.append('id_ubicacion', String(data.id_ubicacion));
    }
    formData.append('id_empleado', String(data.id_empleado));
    formData.append('id_tipo_instalacion', String(data.id_tipo_instalacion));
    formData.append('fecha_programada', data.fecha_programada);
    formData.append('hora_programada', data.hora_programada);
    formData.append('motivo_visita', data.motivo_visita);
    if (data.indicaciones) {
      formData.append('indicaciones', data.indicaciones);
    }
    if (data.observaciones) {
      formData.append('observaciones', data.observaciones);
    }
    return formData;
  }
}
