export type TipoTarea = 'Visita Técnica' | 'Instalación';
export type EstadoTarea = 'Programada' | 'En Proceso' | 'Completada';

export interface TareaTecnico {
  id_empleado: number;
  codigo: string;
  nombre: string;
  es_encargado: boolean;
}

export interface Tarea {
  id: number;
  tipo: TipoTarea;
  id_visita: number | null;
  id_instalacion: number | null;
  id_cliente: number;
  id_ubicacion: number | null;
  numero_propiedad: number | null;
  direccion_propiedad: string | null;
  referencia_propiedad: string | null;
  foto_fachada: string | null;
  latitud: number | null;
  longitud: number | null;
  cliente: string;
  fecha: string;
  hora: string;
  descripcion: string | null;
  estado: EstadoTarea;
  id_tipo_instalacion: number | null;
  tipo_instalacion: string | null;
  tecnicos: TareaTecnico[];
  ubicacion_disponible: boolean;
  puede_ver: boolean;
  puede_realizar_acciones: boolean;
  es_responsable: boolean;
  bloqueada: boolean;
}
