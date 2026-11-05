import { TestBed } from '@angular/core/testing';

import { GoogleMapsLoaderService } from './google-maps-loader.service';

describe('GoogleMapsLoaderService', () => {
  beforeEach(() => {
    document.getElementById('sistemawisp-google-maps')?.remove();
    delete window.google;
    delete window.__sistemaWispGoogleMapsLoaded;
    window.__SISTEMAWISP_CONFIG__ = {
      googleMapsApiKey: 'test-key',
      googleMapsMapId: 'test-map-id',
    };
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    document.getElementById('sistemawisp-google-maps')?.remove();
    delete window.google;
    delete window.__sistemaWispGoogleMapsLoaded;
    delete window.__SISTEMAWISP_CONFIG__;
  });

  it('carga Maps JavaScript API una sola vez y reutiliza la misma promesa', async () => {
    const importLibrary = vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(
          name === 'maps'
            ? { Map: class MockMap {} }
            : { AdvancedMarkerElement: class MockMarker {} },
        ),
      );
    const service = TestBed.inject(GoogleMapsLoaderService);

    const first = service.load();
    const second = service.load();

    expect(first).toBe(second);
    expect(document.querySelectorAll('#sistemawisp-google-maps')).toHaveLength(1);
    const script = document.getElementById('sistemawisp-google-maps') as HTMLScriptElement;
    expect(script.src).toContain('maps.googleapis.com/maps/api/js');
    expect(script.src).toContain('loading=async');
    window.google = { maps: { importLibrary } };
    window.__sistemaWispGoogleMapsLoaded?.();

    await expect(first).resolves.toEqual({
      mapId: 'test-map-id',
      Map: expect.any(Function),
      AdvancedMarkerElement: expect.any(Function),
    });
    expect(importLibrary).toHaveBeenCalledTimes(2);
  });

  it('falla de forma controlada cuando no existe configuración', async () => {
    window.__SISTEMAWISP_CONFIG__ = { googleMapsApiKey: '', googleMapsMapId: '' };
    const service = TestBed.inject(GoogleMapsLoaderService);

    await expect(service.load()).rejects.toThrow('Google Maps no está configurado');
    expect(document.getElementById('sistemawisp-google-maps')).toBeNull();
  });

  it('falla de forma controlada cuando falta el Map ID', async () => {
    window.__SISTEMAWISP_CONFIG__ = { googleMapsApiKey: 'test-key', googleMapsMapId: '' };
    const service = TestBed.inject(GoogleMapsLoaderService);

    await expect(service.load()).rejects.toThrow('Google Maps no está configurado');
    expect(document.getElementById('sistemawisp-google-maps')).toBeNull();
  });

  it('permite reintentar después de un fallo transitorio del script', async () => {
    const service = TestBed.inject(GoogleMapsLoaderService);
    const first = service.load();
    const failedScript = document.getElementById('sistemawisp-google-maps') as HTMLScriptElement;

    failedScript.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('No fue posible cargar Google Maps');
    expect(document.getElementById('sistemawisp-google-maps')).toBeNull();

    const importLibrary = vi.fn().mockImplementation((name: string) =>
      Promise.resolve(
        name === 'maps'
          ? { Map: class MockMap {} }
          : { AdvancedMarkerElement: class MockMarker {} },
      ),
    );
    const second = service.load();
    expect(second).not.toBe(first);
    window.google = { maps: { importLibrary } };
    window.__sistemaWispGoogleMapsLoaded?.();

    await expect(second).resolves.toEqual({
      mapId: 'test-map-id',
      Map: expect.any(Function),
      AdvancedMarkerElement: expect.any(Function),
    });
  });
});
