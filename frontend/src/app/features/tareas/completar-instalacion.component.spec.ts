import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompletarInstalacionComponent } from './completar-instalacion.component';

describe('CompletarInstalacionComponent', () => {
  let fixture: ComponentFixture<CompletarInstalacionComponent>;
  let component: CompletarInstalacionComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompletarInstalacionComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CompletarInstalacionComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', { cliente: 'Juan Francisco Martínez Ruiz' });
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
});
