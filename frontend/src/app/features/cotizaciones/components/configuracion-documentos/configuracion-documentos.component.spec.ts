import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ConfiguracionDocumentoResponseDto } from '../../models/cotizacion.models';
import { CotizacionesService } from '../../services/cotizaciones.service';
import { ConfiguracionDocumentosComponent } from './configuracion-documentos.component';

const configuracion: ConfiguracionDocumentoResponseDto = {
  id_configuracion: 3,
  version: 2,
  nombre_comercial: 'Empresa de prueba',
  nit: '1234-5',
  direccion: 'Zona 1',
  telefono: '5555-5555',
  correo: 'empresa@example.com',
  logo_url: null,
  terminos_cotizacion: 'Validez de 15 días.',
  terminos_proforma: 'Pago contra entrega.',
  mensaje_final: 'Gracias por su preferencia.',
  estado: 'Activo',
  fecha_creacion: '2026-10-23T10:00:00',
};

describe('ConfiguracionDocumentosComponent', () => {
  const service = {
    getLatestDocumentConfiguration: vi.fn(),
    saveDocumentConfiguration: vi.fn(),
    publishDocumentConfiguration: vi.fn(),
  };

  beforeEach(async () => {
    service.getLatestDocumentConfiguration.mockReturnValue(of(configuracion));
    service.saveDocumentConfiguration.mockReturnValue(
      of({ ...configuracion, id_configuracion: 4, version: 3, estado: 'Borrador' }),
    );
    service.publishDocumentConfiguration.mockReturnValue(
      of({ ...configuracion, id_configuracion: 4, version: 3 }),
    );
    await TestBed.configureTestingModule({
      imports: [ConfiguracionDocumentosComponent],
      providers: [provideRouter([]), { provide: CotizacionesService, useValue: service }],
    }).compileComponents();
  });

  it('carga la última versión y muestra ambas vistas previas', () => {
    const fixture = TestBed.createComponent(ConfiguracionDocumentosComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.nombre_comercial.value).toBe('Empresa de prueba');
    expect(fixture.componentInstance.version()).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('COTIZACIÓN');

    fixture.componentInstance.tipoPreview.set('PROFORMA');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('PROFORMA');
    expect(fixture.nativeElement.textContent).toContain('FIRMA DEL CLIENTE');
    expect(fixture.nativeElement.textContent).not.toContain('FIRMA AUTORIZADA');
  });

  it('guarda una versión y la publica', () => {
    const fixture = TestBed.createComponent(ConfiguracionDocumentosComponent);
    fixture.detectChanges();

    fixture.componentInstance.guardar();

    expect(service.saveDocumentConfiguration).toHaveBeenCalled();
    expect(service.publishDocumentConfiguration).toHaveBeenCalledWith(4);
    expect(fixture.componentInstance.successMessage()).toContain('versión 3');
  });
});
