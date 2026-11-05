import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, RouterOutlet, provideRouter } from '@angular/router';

import { MantenimientoComponent } from './mantenimiento.component';

@Component({ template: '<router-outlet />', imports: [RouterOutlet] })
class TestShellComponent {}

@Component({ template: '<h1>Formulario administrativo</h1>' })
class TestConfiguracionDocumentosComponent {}

describe('MantenimientoComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MantenimientoComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('muestra la ruta, el título y el subtítulo', () => {
    const fixture = TestBed.createComponent(MantenimientoComponent);
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Configuración');
    expect(texto).toContain('Mantenimiento del Sistema');
    expect(texto).toContain('Administre catálogos del sistema y configuración de documentos');
  });

  it('habilita Catálogos, Cotización / Proforma y Factura / Comprobante', () => {
    const fixture = TestBed.createComponent(MantenimientoComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const opciones = Array.from(
      element.querySelectorAll<HTMLAnchorElement>('a.maintenance-option'),
    );
    const botones = Array.from(
      element.querySelectorAll<HTMLButtonElement>('button.maintenance-option'),
    );

    expect(opciones.map((opcion) => opcion.textContent?.trim())).toEqual([
      'Catálogos',
      'Cotización / Proforma',
      'Factura / Comprobante',
    ]);
    expect(opciones[0].getAttribute('href')).toBe('/configuracion/mantenimiento/catalogos');
    expect(opciones[1].getAttribute('href')).toBe(
      '/configuracion/mantenimiento/documentos-comerciales',
    );
    expect(opciones[2].getAttribute('href')).toBe(
      '/configuracion/mantenimiento/factura-comprobante',
    );
    expect(botones).toHaveLength(0);
    expect(element.querySelector('.catalogs-maintenance-icon')).not.toBeNull();
    expect(element.querySelector('.quotation-maintenance-icon')).not.toBeNull();
    expect(element.querySelector('.invoice-maintenance-icon')).not.toBeNull();
  });

  it('navega al formulario al activar Cotización / Proforma', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MantenimientoComponent],
      providers: [
        provideRouter([
          {
            path: '',
            component: TestShellComponent,
            children: [
              { path: 'configuracion/mantenimiento', component: MantenimientoComponent },
              {
                path: 'configuracion/mantenimiento/documentos-comerciales',
                component: TestConfiguracionDocumentosComponent,
              },
            ],
          },
        ]),
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(TestShellComponent);
    await router.navigateByUrl('/configuracion/mantenimiento');
    fixture.detectChanges();

    const enlace = fixture.nativeElement.querySelector(
      'a[href="/configuracion/mantenimiento/documentos-comerciales"]',
    ) as HTMLAnchorElement;
    enlace.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(router.url).toBe('/configuracion/mantenimiento/documentos-comerciales');
    expect(fixture.nativeElement.textContent).toContain('Formulario administrativo');
  });
});
