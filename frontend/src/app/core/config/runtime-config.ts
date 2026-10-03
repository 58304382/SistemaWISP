export interface SistemaWispRuntimeConfig {
  googleMapsApiKey?: string;
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
