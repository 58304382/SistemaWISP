/** Contratos de la configuración de comprobantes administrada en Mantenimiento. */

export type EstadoConfiguracionComprobante = 'Activa' | 'Inactiva';

export interface ConfiguracionComprobanteResponseDto {
  id_configuracion: number;
  version: number;
  nombre_comercial: string;
  descripcion_empresa: string | null;
  direccion: string | null;
  telefono: string | null;
  mensaje_final: string | null;
  nota_fiscal: string | null;
  estado: EstadoConfiguracionComprobante;
  fecha_creacion: string;
  fecha_publicacion: string | null;
}

export interface ConfiguracionComprobanteInputDto {
  nombre_comercial: string;
  descripcion_empresa: string;
  direccion: string;
  telefono: string;
  mensaje_final: string;
  nota_fiscal: string;
}
