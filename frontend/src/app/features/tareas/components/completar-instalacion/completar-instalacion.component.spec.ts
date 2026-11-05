import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { Instalacion } from '../../../instalaciones/models/instalacion.models';
import { InstalacionesService } from '../../../instalaciones/services/instalaciones.service';

import { CompletarInstalacionComponent } from './completar-instalacion.component';

describe('CompletarInstalacionComponent', () => {
  let fixture: ComponentFixture<CompletarInstalacionComponent>;
  let component: CompletarInstalacionComponent;
  let service: { complete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { complete: vi.fn().mockReturnValue(of({ id_instalacion: 9, estado: 'Completada' })) };
    await TestBed.configureTestingModule({
      imports: [CompletarInstalacionComponent],
      providers: [{ provide: InstalacionesService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(CompletarInstalacionComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', { cliente: 'Juan Francisco Martínez Ruiz', id_instalacion: 9 });
    fixture.detectChanges();
  });

  it('muestra el cliente y valida observación y evidencia obligatorias', () => {
    expect(fixture.nativeElement.textContent).toContain('Juan Francisco Martínez Ruiz');

    component.submit(new Event('submit'));

    expect(component.observationError()).toContain('obligatoria');
    expect(component.evidenceError()).toContain('obligatoria');
  });

  it('acepta una imagen y prepara su vista previa local', () => {
    const createObjectUrl = vi.fn().mockReturnValue('blob:evidence');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    const photo = new File(['image'], 'evidencia.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: { item: (index: number) => (index === 0 ? photo : null), length: 1, 0: photo },
    });

    component.onPhotoChange({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.evidencePhoto()).toBe(photo);
    expect(component.evidencePreviewUrl()).toBe('blob:evidence');
    expect(fixture.nativeElement.querySelector('.evidence-preview img')).toBeTruthy();
  });

  it('guarda observación y evidencia mediante el servicio y evita envíos repetidos', () => {
    const respuesta = new Subject<Instalacion>();
    service.complete.mockReturnValue(respuesta);
    const guardar = vi.spyOn(component.saved, 'emit');
    const cerrar = vi.spyOn(component.closed, 'emit');
    const archivo = new File(['image'], 'evidencia.png', { type: 'image/png' });
    component.technicalObservation.set(' Enlace validado ');
    component.evidencePhoto.set(archivo);
    component.submit(new Event('submit'));
    component.submit(new Event('submit'));
    component.cancel();
    expect(service.complete).toHaveBeenCalledOnce();
    expect(service.complete).toHaveBeenCalledWith(9, 'Enlace validado', archivo);
    expect(cerrar).not.toHaveBeenCalled();
    const resultado = { id_instalacion: 9, estado: 'Completada' } as Instalacion;
    respuesta.next(resultado);
    respuesta.complete();
    expect(guardar).toHaveBeenCalledWith(resultado);
    expect(component.isSaving()).toBe(false);
  });

  it('conserva el formulario si el backend rechaza el cierre', () => {
    service.complete.mockReturnValue(throwError(() => new Error('Fallo simulado')));
    component.technicalObservation.set('Observación');
    component.evidencePhoto.set(new File(['image'], 'evidencia.png', { type: 'image/png' }));
    const guardar = vi.spyOn(component.saved, 'emit');
    component.submit(new Event('submit'));
    expect(component.formMessage()).not.toBe('');
    expect(component.isSaving()).toBe(false);
    expect(guardar).not.toHaveBeenCalled();
  });
});
