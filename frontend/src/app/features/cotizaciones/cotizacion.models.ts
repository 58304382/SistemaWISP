// Estados y orígenes exclusivos del flujo comercial. La revisión del
// formulario es una vista local y no agrega estados al contrato.
export const ESTADOS_COTIZACION = [
  'EN PROCESO',
  'GENERADA',
  'ACEPTADA',
  'RECHAZADA',
  'COMPLETADA',
] as const;

export const ORIGENES_COTIZACION = ['DIRECTA', 'EVALUACION'] as const;

export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];
export type OrigenCotizacion = (typeof ORIGENES_COTIZACION)[number];
export type TipoDocumentoComercial = 'COTIZACION' | 'PROFORMA';
export type TamanoDocumento = 'CARTA' | 'OFICIO';
export type AccionCotizacion =
  | 'VER'
  | 'EDITAR'
  | 'GENERAR_COTIZACION'
  | 'ACEPTAR'
  | 'RECHAZAR'
  | 'ELIMINAR'
  | 'GENERAR_PROFORMA'
  | 'VER_PROFORMA';

// ==========================================
// DTOs DEL CONTRATO HTTP
// ==========================================

// Los DTOs no contienen idTemporal ni campos calculados por Angular.
export interface DetalleCotizacionInputDto {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number | null;
}

export interface DetalleCotizacionDirectaInputDto extends DetalleCotizacionInputDto {
  precio_unitario: number;
}

export interface CotizacionDirectaCreateDto {
  id_cliente: number;
  porcentaje_descuento: number;
  observaciones?: string | null;
  detalles: DetalleCotizacionDirectaInputDto[];
}

export interface CotizacionEvaluacionCreateDto {
  id_evaluacion: number;
  porcentaje_descuento: number;
  observaciones?: string | null;
}

export interface CotizacionUpdateDto {
  porcentaje_descuento?: number;
  observaciones?: string | null;
  detalles?: DetalleCotizacionInputDto[];
}

export interface ClienteCotizacionResponseDto {
  id_cliente: number;
  nombres: string;
  apellidos: string;
  telefono: string;
  direccion: string;
  departamento: string;
  municipio: string;
}

// Pydantic serializa Decimal como string en el contrato OpenAPI. La conversión
// a number ocurre una sola vez al construir el modelo de presentación.
export type DecimalResponseDto = string;

export interface DetalleCotizacionResponseDto {
  id_detalle: number;
  descripcion: string;
  cantidad: DecimalResponseDto;
  unidad: string | null;
  // Una cotización de Evaluación permanece incompleta hasta asignar sus precios.
  precio_unitario: DecimalResponseDto | null;
  subtotal_detalle: DecimalResponseDto;
}

export interface ProformaResumenResponseDto {
  id_proforma: number;
  fecha_generacion: string;
}

export interface CotizacionResponseDto {
  id_cotizacion: number;
  numero_cotizacion: string;
  fecha: string;
  fecha_actualizacion: string;
  origen: OrigenCotizacion;
  id_evaluacion: number | null;
  estado: EstadoCotizacion;
  porcentaje_descuento: DecimalResponseDto;
  observaciones: string | null;
  cliente: ClienteCotizacionResponseDto;
  detalles: DetalleCotizacionResponseDto[];
  subtotal: DecimalResponseDto;
  monto_descuento: DecimalResponseDto;
  total: DecimalResponseDto;
  tiene_proforma: boolean;
  proforma: ProformaResumenResponseDto | null;
}

export interface ProformaResponseDto {
  id_proforma: number;
  fecha_generacion: string;
  cotizacion: CotizacionResponseDto;
}

// ==========================================
// MODELOS DE PRESENTACIÓN
// ==========================================

export interface ClienteCotizacionVista {
  id_cliente: number;
  nombres: string;
  apellidos: string;
  telefono: string;
  direccion: string;
  departamento: string;
  municipio: string;
}

export interface DetalleCotizacion {
  id_detalle: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number | null;
  subtotal_detalle: number;
}

// idTemporal identifica filas exclusivamente mientras se edita en Angular.
export interface DetalleCotizacionFormulario {
  idTemporal: number;
  id_detalle?: number;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number | null;
}

export interface ProformaResumenVista {
  id_proforma: number;
  fecha_generacion: string;
}

export interface CotizacionVista {
  id_cotizacion: number;
  numero_cotizacion: string;
  cliente: ClienteCotizacionVista;
  fecha: string;
  fecha_actualizacion: string;
  estado: EstadoCotizacion;
  origen: OrigenCotizacion;
  id_evaluacion: number | null;
  detalles: DetalleCotizacion[];
  porcentaje_descuento: number;
  subtotal: number;
  monto_descuento: number;
  total: number;
  tiene_proforma: boolean;
  proforma: ProformaResumenVista | null;
}

export interface DatosEmpresaDocumento {
  logoUrl: string | null;
  nombreComercial: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  informacionInstitucional: string | null;
  firmaUrl: string | null;
  nombreFirmante: string | null;
  cargoFirmante: string | null;
  // Configuración podrá proporcionar estos textos; su ausencia no reserva espacio.
  terminosCondiciones?: string[] | null;
  mensajeFinal?: string | null;
}

// DocumentoComercial es un modelo de presentación, nunca un DTO HTTP.
export interface DocumentoComercial {
  tipo: TipoDocumentoComercial;
  cotizacion: CotizacionVista;
  empresa: DatosEmpresaDocumento | null;
  fecha_generacion: string | null;
}

// ==========================================
// TRANSFORMACIONES
// ==========================================

export function detalleFormularioADto(
  detalle: DetalleCotizacionFormulario,
): DetalleCotizacionInputDto {
  // Se enumeran los campos para impedir que idTemporal salga en el payload.
  return {
    descripcion: detalle.descripcion.trim(),
    cantidad: detalle.cantidad,
    unidad: detalle.unidad?.trim() || null,
    precio_unitario: detalle.precio_unitario,
  };
}

export function cotizacionResponseAVista(dto: CotizacionResponseDto): CotizacionVista {
  return {
    id_cotizacion: dto.id_cotizacion,
    numero_cotizacion: dto.numero_cotizacion,
    cliente: { ...dto.cliente },
    fecha: dto.fecha,
    fecha_actualizacion: dto.fecha_actualizacion,
    estado: dto.estado,
    origen: dto.origen,
    id_evaluacion: dto.id_evaluacion,
    detalles: dto.detalles.map((detalle) => ({
      ...detalle,
      cantidad: decimalResponseANumber(detalle.cantidad),
      precio_unitario:
        detalle.precio_unitario === null
          ? null
          : decimalResponseANumber(detalle.precio_unitario),
      subtotal_detalle: decimalResponseANumber(detalle.subtotal_detalle),
    })),
    porcentaje_descuento: decimalResponseANumber(dto.porcentaje_descuento),
    subtotal: decimalResponseANumber(dto.subtotal),
    monto_descuento: decimalResponseANumber(dto.monto_descuento),
    total: decimalResponseANumber(dto.total),
    tiene_proforma: dto.tiene_proforma,
    proforma: dto.proforma ? { ...dto.proforma } : null,
  };
}

export function proformaResponseADocumento(
  dto: ProformaResponseDto,
  empresa: DatosEmpresaDocumento | null,
): DocumentoComercial {
  return {
    tipo: 'PROFORMA',
    cotizacion: cotizacionResponseAVista(dto.cotizacion),
    empresa,
    fecha_generacion: dto.fecha_generacion,
  };
}

export function cotizacionResponseADocumento(
  dto: CotizacionResponseDto,
  empresa: DatosEmpresaDocumento | null,
): DocumentoComercial {
  return {
    tipo: 'COTIZACION',
    cotizacion: cotizacionResponseAVista(dto),
    empresa,
    fecha_generacion: null,
  };
}

// ==========================================
// REGLAS VISUALES DE ACCIONES
// ==========================================

type ContextoAccionesCotizacion = Pick<
  CotizacionVista,
  'estado' | 'origen' | 'tiene_proforma' | 'detalles'
>;

export function cotizacionTienePreciosCompletos(
  cotizacion: Pick<CotizacionVista, 'detalles'>,
): boolean {
  return (
    cotizacion.detalles.length > 0 &&
    cotizacion.detalles.every((detalle) => detalle.precio_unitario !== null)
  );
}

// La visibilidad combina estado, origen, precios y Proforma. FastAPI seguirá
// siendo la autoridad definitiva para autorizar cada transición.
export function obtenerAccionesCotizacion(
  cotizacion: ContextoAccionesCotizacion,
): AccionCotizacion[] {
  switch (cotizacion.estado) {
    case 'EN PROCESO':
      return [
        'VER',
        'EDITAR',
        ...(cotizacion.origen === 'EVALUACION' && cotizacionTienePreciosCompletos(cotizacion)
          ? (['GENERAR_COTIZACION'] as const)
          : []),
        'RECHAZAR',
      ];
    case 'GENERADA':
      return [
        'VER',
        'EDITAR',
        'ACEPTAR',
        'RECHAZAR',
        ...(cotizacion.origen === 'DIRECTA' ? (['ELIMINAR'] as const) : []),
      ];
    case 'ACEPTADA':
      return ['VER', cotizacion.tiene_proforma ? 'VER_PROFORMA' : 'GENERAR_PROFORMA'];
    case 'RECHAZADA':
      return ['VER'];
    case 'COMPLETADA':
      return ['VER', ...(cotizacion.tiene_proforma ? (['VER_PROFORMA'] as const) : [])];
  }
}

type DetalleCalculable = Pick<DetalleCotizacionFormulario, 'cantidad' | 'precio_unitario'>;

export function calcularSubtotalDetalle(detalle: DetalleCalculable): number {
  // Un precio pendiente conserva null en el modelo y aporta cero solo a la vista previa.
  return redondearMoneda(detalle.cantidad * (detalle.precio_unitario ?? 0));
}

// Estos importes apoyan la captura local. Tras integrar HTTP, los totales de
// CotizacionResponseDto serán los valores autoritativos para registros guardados.
export function calcularResumenCotizacion(
  detalles: DetalleCalculable[],
  porcentajeDescuento: number,
): { subtotal: number; descuento: number; total: number } {
  const subtotal = redondearMoneda(
    detalles.reduce((acumulado, detalle) => acumulado + calcularSubtotalDetalle(detalle), 0),
  );
  const porcentajeSeguro = Math.min(100, Math.max(0, porcentajeDescuento || 0));
  const descuento = redondearMoneda((subtotal * porcentajeSeguro) / 100);
  return { subtotal, descuento, total: redondearMoneda(subtotal - descuento) };
}

function redondearMoneda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function decimalResponseANumber(valor: DecimalResponseDto): number {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    throw new Error('FastAPI devolvió un valor decimal inválido.');
  }
  return numero;
}
