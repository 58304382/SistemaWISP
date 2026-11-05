import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { TicketsService } from '../../services/tickets.service';
import { TicketDetalle } from '../../models/ticket.models';
import { FinalizarSoporteComponent } from './finalizar-soporte.component';

/** Valida el cierre sin red ni archivos persistidos; la decodificación del navegador se controla explícitamente. */
describe('FinalizarSoporteComponent', () => {
  let fixture: ComponentFixture<FinalizarSoporteComponent>;
  let component: FinalizarSoporteComponent;
  let service: { complete: ReturnType<typeof vi.fn> };
  let images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; naturalWidth: number; naturalHeight: number }>;
  const completed = { id_ticket: 7, estado: 'Completada' } as TicketDetalle;

  beforeEach(async () => {
    images = [];
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = vi.fn().mockReturnValue('blob:foto-test');
      static override revokeObjectURL = vi.fn();
    });
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 10;
      naturalHeight = 10;
      src = '';
      constructor() { images.push(this); }
    });
    service = { complete: vi.fn().mockReturnValue(of(completed)) };
    await TestBed.configureTestingModule({ imports: [FinalizarSoporteComponent], providers: [{ provide: TicketsService, useValue: service }] }).compileComponents();
    fixture = TestBed.createComponent(FinalizarSoporteComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('idTicket', 7); fixture.componentRef.setInput('cliente', 'Cliente de prueba'); fixture.detectChanges();
  });

  afterEach(() => { fixture.destroy(); vi.unstubAllGlobals(); });

  function informe(): void {
    component.form.setValue({ trabajo_realizado: ' Reparar enlace ', resultado_solucion: ' Señal estable ', observaciones: '  ' });
  }

  /** Cámara y galería se prueban sobre el mismo manejador, sin crear otra ruta de validación. */
  function seleccionar(file = new File(['imagen'], 'foto.png', { type: 'image/png' }), source: 'camera' | 'gallery' = 'gallery'): File {
    const input = fixture.nativeElement.querySelector(`#support-${source}-evidence`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: { item: () => file } });
    input.dispatchEvent(new Event('change'));
    return file;
  }

  it('exige trabajo, resultado y fotografía; rechaza texto vacío o solo espacios', () => {
    component.submit();
    expect(service.complete).not.toHaveBeenCalled(); expect(component.photoError()).toContain('obligatoria');
    informe(); component.form.controls.trabajo_realizado.setValue('   ');
    seleccionar(); images[0].onload?.(); component.submit();
    expect(service.complete).not.toHaveBeenCalled();
    component.form.controls.trabajo_realizado.setValue('Trabajo'); component.form.controls.resultado_solucion.setValue('  '); component.submit();
    expect(service.complete).not.toHaveBeenCalled();
  });

  it('rechaza tipo no permitido, archivo vacío y fotografía mayor de 5 MB', () => {
    informe();
    for (const file of [new File(['texto'], 'archivo.txt', { type: 'text/plain' }), new File([], 'vacia.png', { type: 'image/png' }), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })]) {
      seleccionar(file); expect(component.photo()).toBeNull(); expect(component.photoError()).not.toBe(''); component.submit();
    }
    expect(images).toHaveLength(0); expect(service.complete).not.toHaveBeenCalled();
  });

  it('no acepta un archivo con MIME de imagen si falla su decodificación', () => {
    informe(); seleccionar(); images[0].onload?.();
    expect(component.photo()).not.toBeNull();
    seleccionar(new File(['contenido falso'], 'falsa.png', { type: 'image/png' })); images[1].onerror?.();
    component.submit();
    expect(component.photo()).toBeNull(); expect(component.preview()).toBeNull(); expect(service.complete).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('espera validación de imagen y envía informe normalizado con su fotografía', () => {
    informe(); const file = seleccionar(); component.submit();
    expect(component.validatingPhoto()).toBe(true); expect(service.complete).not.toHaveBeenCalled();
    images[0].onload?.(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:foto-test');
    const saved = vi.spyOn(component.saved, 'emit'); component.submit();
    expect(service.complete).toHaveBeenCalledWith(7, { trabajo_realizado: 'Reparar enlace', resultado_solucion: 'Señal estable', observaciones: null }, file);
    expect(saved).toHaveBeenCalledWith(completed); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('evita doble envío y cierre en curso; conserva informe y archivo si FastAPI rechaza', () => {
    const response = new Subject<TicketDetalle>(); service.complete.mockReturnValue(response);
    informe(); seleccionar(); images[0].onload?.();
    const closed = vi.spyOn(component.closed, 'emit'); component.submit(); component.submit(); component.cancel();
    expect(service.complete).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled();
    response.error(new HttpErrorResponse({ status: 403, error: { detail: 'Asignado a otro técnico' } }));
    expect(component.saving()).toBe(false); expect(component.error()).not.toBe(''); expect(component.photo()).not.toBeNull();
    expect(component.form.controls.trabajo_realizado.value).toContain('Reparar enlace');
  });

  it('cancelar libera la vista previa y descarta validaciones pendientes sin finalizar', () => {
    seleccionar(); const closed = vi.spyOn(component.closed, 'emit'); component.cancel(); images[0].onload?.();
    expect(closed).toHaveBeenCalledOnce(); expect(component.photo()).toBeNull(); expect(component.preview()).toBeNull();
    expect(service.complete).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('ofrece cámara trasera y galería con los íconos y el mismo flujo de vista previa', () => {
    const camera = fixture.nativeElement.querySelector('#support-camera-evidence') as HTMLInputElement;
    const gallery = fixture.nativeElement.querySelector('#support-gallery-evidence') as HTMLInputElement;
    expect(camera.getAttribute('capture')).toBe('environment'); expect(gallery.hasAttribute('capture')).toBe(false);
    const labels = fixture.nativeElement.querySelectorAll('.evidence-options label') as NodeListOf<HTMLLabelElement>;
    expect(labels[0].control).toBe(camera); expect(labels[0].textContent).toContain('Tomar fotografía');
    expect(labels[1].control).toBe(gallery); expect(labels[1].textContent).toContain('Seleccionar imagen');
    expect(labels[0].querySelector('svg')).not.toBeNull(); expect(labels[1].querySelector('svg')).not.toBeNull();
    const first = seleccionar(new File(['primera'], 'camara.jpg', { type: 'image/jpeg' }), 'camera'); images[0].onload?.();
    expect(component.photo()).toBe(first);
    const replacement = seleccionar(new File(['segunda'], 'galeria.webp', { type: 'image/webp' })); images[1].onload?.(); fixture.detectChanges();
    expect(component.photo()).toBe(replacement); expect(fixture.nativeElement.querySelector('.evidence-preview').textContent).toContain('galeria.webp');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:foto-test');
  });

  it('elimina la selección y bloquea el cierre hasta adjuntar otra, incluso el mismo archivo', () => {
    informe(); const file = seleccionar(); images[0].onload?.(); fixture.detectChanges();
    const camera = fixture.nativeElement.querySelector('#support-camera-evidence') as HTMLInputElement;
    const gallery = fixture.nativeElement.querySelector('#support-gallery-evidence') as HTMLInputElement;
    Object.defineProperty(camera, 'value', { configurable: true, writable: true, value: 'camara.jpg' });
    Object.defineProperty(gallery, 'value', { configurable: true, writable: true, value: 'foto.png' });
    (fixture.nativeElement.querySelector('.evidence-remove') as HTMLButtonElement).click(); fixture.detectChanges();
    expect(component.photo()).toBeNull(); expect(component.preview()).toBeNull(); expect(camera.value).toBe(''); expect(gallery.value).toBe('');
    expect(fixture.nativeElement.querySelector('.evidence-preview')).toBeNull(); expect(component.form.controls.trabajo_realizado.value).toContain('Reparar enlace');
    component.submit(); expect(service.complete).not.toHaveBeenCalled(); expect(component.photoError()).toContain('obligatoria');
    seleccionar(file); images[1].onload?.(); component.submit();
    expect(service.complete).toHaveBeenCalledWith(7, expect.any(Object), file);
  });

  it('descarta la decodificación pendiente al eliminar y protege la fotografía durante el envío', () => {
    const camera = fixture.nativeElement.querySelector('#support-camera-evidence') as HTMLInputElement;
    const gallery = fixture.nativeElement.querySelector('#support-gallery-evidence') as HTMLInputElement;
    seleccionar(); component.removePhoto(camera, gallery); images[0].onload?.();
    expect(component.photo()).toBeNull(); expect(component.validatingPhoto()).toBe(false);
    const response = new Subject<TicketDetalle>(); service.complete.mockReturnValue(response);
    informe(); const file = seleccionar(); images[1].onload?.(); component.submit(); fixture.detectChanges();
    expect(camera.disabled).toBe(true); expect(gallery.disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('.evidence-remove') as HTMLButtonElement).disabled).toBe(true);
    component.removePhoto(camera, gallery); expect(component.photo()).toBe(file);
    response.next(completed); response.complete();
  });
});
