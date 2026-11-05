import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { TiposInstalacionCatalogoService } from '../../services/tipos-instalacion-catalogo.service';

import { CatalogosComponent } from './catalogos.component';

describe('CatalogosComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogosComponent],
      providers: [provideRouter([]), { provide: TiposInstalacionCatalogoService, useValue: {
        getAll: () => of([]), getCatalogo: () => of([]),
      } }],
    }).compileComponents();
  });

  it('muestra seis opciones y cambia el panel sin navegar a otra página', () => {
    const fixture = TestBed.createComponent(CatalogosComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const texto = element.textContent ?? '';
    const opciones = element.querySelectorAll<HTMLButtonElement>('.catalog-menu button');

    expect(texto).toContain('Configuración');
    expect(texto).toContain('Mantenimiento del Sistema');
    expect(texto).toContain('Catálogos');
    expect(texto).toContain('Tipos de instalación');
    expect(opciones).toHaveLength(6);
    expect(opciones[0].classList.contains('selected')).toBe(true);
    opciones[3].click();
    fixture.detectChanges();
    expect(opciones[3].classList.contains('selected')).toBe(true);
    expect(element.querySelector('.catalog-panel h1')?.textContent).toBe('Métodos de pago');
    expect(element.querySelector('.catalog-panel app-tipos-instalacion')).not.toBeNull();
    expect(element.querySelectorAll('.catalog-panel app-tipos-instalacion')).toHaveLength(1);
  });
});
