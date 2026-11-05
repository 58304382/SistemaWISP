import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ConfiguracionComprobanteResponseDto } from '../../models/comprobante-configuracion.models';
import { ComprobanteConfiguracionService } from '../../services/comprobante-configuracion.service';
import { ConfiguracionComprobantesComponent } from './configuracion-comprobantes.component';

const CONFIGURACION: ConfiguracionComprobanteResponseDto = {
  id_configuracion: 1,
  version: 2,
  nombre_comercial: 'Multiservicios Tale',
  descripcion_empresa: 'Internet y telecomunicaciones',
  direccion: 'Zona 1',
  telefono: '2222-2222',
  mensaje_final: '¡Gracias por su preferencia!',
  nota_fiscal: 'No constituye comprobante fiscal.',
  estado: 'Activa',
  fecha_creacion: '2026-11-03T10:00:00',
  fecha_publicacion: '2026-11-03T10:00:00',
};

describe('ConfiguracionComprobantesComponent', () => {
  let fixture: ComponentFixture<ConfiguracionComprobantesComponent>;
  let component: ConfiguracionComprobantesComponent;
  let service: {
    getActiva: ReturnType<typeof vi.fn>;
    getUltima: ReturnType<typeof vi.fn>;
    guardar: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getActiva: vi.fn().mockReturnValue(of(CONFIGURACION)),
      getUltima: vi.fn().mockReturnValue(of(CONFIGURACION)),
      guardar: vi.fn().mockReturnValue(of({ ...CONFIGURACION, version: 3 })),
    };

    await TestBed.configureTestingModule({
      imports: [ConfiguracionComprobantesComponent],
      providers: [
        provideRouter([]),
        { provide: ComprobanteConfiguracionService, useValue: service },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfiguracionComprobantesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga la configuración activa y actualiza la vista previa', () => {
    expect(service.getActiva).toHaveBeenCalledOnce();
    expect(component.version()).toBe(2);
    expect(component.estado()).toBe('Activa');
    expect(component.form.controls.nombre_comercial.value).toBe('Multiservicios Tale');
    expect(fixture.nativeElement.textContent).toContain('Internet y telecomunicaciones');
  });

  it('usa valores por defecto cuando no existe configuración activa', () => {
    service.getActiva.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    fixture = TestBed.createComponent(ConfiguracionComprobantesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.version()).toBeNull();
    expect(component.estado()).toBe('Sin configuración');
    expect(fixture.nativeElement.textContent).toContain('Multiservicios Tale');
  });

  it('rechaza guardar sin nombre comercial y no llama al backend', () => {
    component.form.controls.nombre_comercial.setValue('   ');
    component.guardar();

    expect(service.guardar).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('obligatorio');
  });

  it('guarda una versión nueva y muestra el mensaje de éxito', () => {
    component.form.patchValue({ telefono: '3333-3333' });
    component.guardar();

    expect(service.guardar).toHaveBeenCalledOnce();
    expect(service.guardar.mock.calls[0][0]).toMatchObject({
      nombre_comercial: 'Multiservicios Tale',
      telefono: '3333-3333',
    });
    expect(component.version()).toBe(3);
    expect(component.successMessage()).toContain('versión 3');
  });

  it('cancela los cambios y restaura la última configuración guardada', () => {
    component.form.controls.nombre_comercial.setValue('Otro nombre');
    component.cancelar();

    expect(component.form.controls.nombre_comercial.value).toBe('Multiservicios Tale');
    expect(component.errorMessage()).toBe('');
    expect(component.successMessage()).toBe('');
  });

  it('actualiza la vista previa en tiempo real con los campos editables', () => {
    component.form.patchValue({
      descripcion_empresa: 'Soporte técnico especializado',
      nota_fiscal: 'Comprobante interno',
    });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Soporte técnico especializado');
    expect(texto).toContain('Comprobante interno');
  });

  it('oculta la nota fiscal al vaciarla y permite guardar el cambio', () => {
    component.form.controls.nota_fiscal.setValue('');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.receipt-preview-note')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('No constituye comprobante fiscal.');

    component.guardar();

    expect(service.guardar).toHaveBeenCalledOnce();
    expect(service.guardar.mock.calls[0][0].nota_fiscal).toBe('');
  });
});
