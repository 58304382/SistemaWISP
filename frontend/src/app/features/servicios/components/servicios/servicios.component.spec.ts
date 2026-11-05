import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ServiciosComponent } from './servicios.component';

describe('ServiciosComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiciosComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('muestra el encabezado y los dos accesos principales', () => {
    const fixture = TestBed.createComponent(ServiciosComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const texto = element.textContent ?? '';
    const opciones = Array.from(element.querySelectorAll<HTMLAnchorElement>('.services-option'));

    expect(texto).toContain('Servicios');
    expect(texto).toContain(
      'Administre los servicios de Internet y el control de mensualidades de los clientes',
    );
    expect(opciones.map((opcion) => opcion.textContent?.trim())).toEqual([
      'Servicios de Internet',
      'Asignación de Planes',
    ]);
    expect(opciones.map((opcion) => opcion.getAttribute('href'))).toEqual([
      '/servicios/internet',
      '/servicios/mensualidades',
    ]);
    expect(element.querySelector('.internet-services-icon')).not.toBeNull();
    expect(element.querySelector('.monthly-services-icon')).not.toBeNull();
  });
});
