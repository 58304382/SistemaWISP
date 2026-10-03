import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_ENDPOINTS } from '../config/api.config';
import { Departamento, Municipio } from '../models/cliente.models';
import { Empleado, EmpleadoUpdate, PuestoEmpleado } from '../models/empleado.models';

@Injectable({ providedIn: 'root' })
export class EmpleadosService {
  private readonly http = inject(HttpClient);

  getAll(): Observable<Empleado[]> {
    return this.http.get<Empleado[]>(API_ENDPOINTS.empleados);
  }

  getById(idEmpleado: number): Observable<Empleado> {
    return this.http.get<Empleado>(`${API_ENDPOINTS.empleados}/${idEmpleado}`);
  }

  getPuestos(): Observable<PuestoEmpleado[]> {
    return this.http.get<PuestoEmpleado[]>(API_ENDPOINTS.puestosEmpleado);
  }

  getDepartamentos(): Observable<Departamento[]> {
    return this.http.get<Departamento[]>(`${API_ENDPOINTS.empleados}/departamentos`);
  }

  getMunicipios(idDepartamento: number): Observable<Municipio[]> {
    return this.http.get<Municipio[]>(
      `${API_ENDPOINTS.empleados}/departamentos/${idDepartamento}/municipios`,
    );
  }

  create(data: FormData): Observable<Empleado> {
    return this.http.post<Empleado>(API_ENDPOINTS.empleados, data);
  }

  update(idEmpleado: number, data: EmpleadoUpdate): Observable<Empleado> {
    return this.http.patch<Empleado>(`${API_ENDPOINTS.empleados}/${idEmpleado}`, data);
  }

  delete(idEmpleado: number): Observable<Empleado> {
    return this.http.delete<Empleado>(`${API_ENDPOINTS.empleados}/${idEmpleado}`);
  }

  replacePhoto(idEmpleado: number, photo: File): Observable<Empleado> {
    const data = new FormData();
    data.append('foto', photo, photo.name);
    return this.http.put<Empleado>(`${API_ENDPOINTS.empleados}/${idEmpleado}/foto`, data);
  }

  removePhoto(idEmpleado: number): Observable<Empleado> {
    return this.http.delete<Empleado>(`${API_ENDPOINTS.empleados}/${idEmpleado}/foto`);
  }
}
