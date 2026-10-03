import { Injectable } from '@angular/core';

import { googleMapsApiKey } from '../config/runtime-config';

export interface MapCoordinates {
  latitud: number;
  longitud: number;
}

export interface GoogleMapsListener {
  remove(): void;
}

export interface GoogleMapInstance {
  addListener(eventName: string, handler: (event: GoogleMapMouseEvent) => void): GoogleMapsListener;
  setCenter(center: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
}

export interface GoogleMapMouseEvent {
  latLng?: { toJSON(): { lat: number; lng: number } } | null;
}

export interface AdvancedMarkerInstance {
  map: GoogleMapInstance | null;
  position: { lat: number; lng: number } | null;
  addListener(eventName: string, handler: () => void): GoogleMapsListener;
}

export interface GoogleMapsApi {
  Map: new (
    element: HTMLElement,
    options: {
      center: { lat: number; lng: number };
      zoom: number;
      mapId: string;
      clickableIcons: boolean;
      streetViewControl: boolean;
      mapTypeControl: boolean;
      fullscreenControl: boolean;
    },
  ) => GoogleMapInstance;
  AdvancedMarkerElement: new (options: {
    map: GoogleMapInstance;
    position: { lat: number; lng: number };
    title: string;
    content?: Node;
  }) => AdvancedMarkerInstance;
}

interface GoogleMapsNamespace {
  importLibrary(name: 'maps' | 'marker'): Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsNamespace };
    __sistemaWispGoogleMapsLoaded?: () => void;
  }
}

const SCRIPT_ID = 'sistemawisp-google-maps';

@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private loadPromise: Promise<GoogleMapsApi> | null = null;

  /** Comparte una sola carga de Maps JavaScript API para toda la aplicación. */
  load(): Promise<GoogleMapsApi> {
    if (this.loadPromise) {
      return this.loadPromise;
    }
    const apiKey = googleMapsApiKey();
    if (!apiKey) {
      this.loadPromise = Promise.reject(
        new Error('Google Maps no está configurado para este entorno.'),
      );
      return this.loadPromise;
    }

    this.loadPromise = this.ensureScript(apiKey).then(async () => {
      const maps = window.google?.maps;
      if (!maps?.importLibrary) {
        throw new Error('Google Maps no pudo inicializarse.');
      }
      const [mapsLibrary, markerLibrary] = await Promise.all([
        maps.importLibrary('maps'),
        maps.importLibrary('marker'),
      ]);
      return {
        Map: mapsLibrary['Map'] as GoogleMapsApi['Map'],
        AdvancedMarkerElement: markerLibrary[
          'AdvancedMarkerElement'
        ] as GoogleMapsApi['AdvancedMarkerElement'],
      };
    });
    return this.loadPromise;
  }

  private ensureScript(apiKey: string): Promise<void> {
    if (window.google?.maps?.importLibrary) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error('No fue posible cargar Google Maps.')),
          { once: true },
        );
        return;
      }

      const script = document.createElement('script');
      const query = new URLSearchParams({
        key: apiKey,
        v: 'weekly',
        loading: 'async',
        callback: '__sistemaWispGoogleMapsLoaded',
      });
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
      window.__sistemaWispGoogleMapsLoaded = () => {
        delete window.__sistemaWispGoogleMapsLoaded;
        resolve();
      };
      script.onerror = () => reject(new Error('No fue posible cargar Google Maps.'));
      document.head.append(script);
    });
  }
}
