export interface SistemaWispRuntimeConfig {
  googleMapsApiKey?: string;
  googleMapsMapId?: string;
}

declare global {
  interface Window {
    __SISTEMAWISP_CONFIG__?: SistemaWispRuntimeConfig;
  }
}

/** Lee configuración inyectada por despliegue antes de iniciar Angular. */
export function googleMapsApiKey(): string {
  return window.__SISTEMAWISP_CONFIG__?.googleMapsApiKey?.trim() ?? '';
}

/** Lee el Map ID propio de SistemaWISP desde la configuración del entorno. */
export function googleMapsMapId(): string {
  return window.__SISTEMAWISP_CONFIG__?.googleMapsMapId?.trim() ?? '';
}
