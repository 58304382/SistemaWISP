export type EstadoEmpleado = 'Activo' | 'Inactivo';

export interface PuestoEmpleado {
  id_puesto: number;
  nombre: string;
  descripcion: string | null;
  estado: EstadoEmpleado;
  tiene_funciones_sistema: boolean;
}

export interface Empleado {
  id_empleado: number;
  codigo: string;
  nombres: string;
  apellidos: string;
  tipo_documento: string;
  numero_documento: string;
  telefono_principal: string;
  telefono_alternativo: string | null;
  correo: string | null;
  direccion: string;
  fecha_ingreso: string;
  estado: EstadoEmpleado;
  observaciones: string | null;
  foto_perfil: string | null;
  id_puesto: number;
  nombre_puesto: string;
  id_municipio: number;
  nombre_municipio: string;
  id_departamento: number;
  nombre_departamento: string;
}

export interface EmpleadoUpdate {
  id_puesto: number;
  id_municipio: number;
  nombres: string;
  apellidos: string;
  tipo_documento: string;
  numero_documento: string;
  telefono_principal: string;
  telefono_alternativo: string | null;
  correo: string | null;
  direccion: string;
  fecha_ingreso: string;
  estado: EstadoEmpleado;
  observaciones: string | null;
}
