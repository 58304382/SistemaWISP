import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { CobrosComponent } from '../cobros/cobros.component';
import { CajaGeneralComponent } from '../caja-general/caja-general.component';
import { FinanzasComponent } from './finanzas.component';

describe('FinanzasComponent', () => {
  let fixture: ComponentFixture<FinanzasComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinanzasComponent],
      providers: [
        provideRouter([
          { path: 'finanzas', component: FinanzasComponent },
          { path: 'finanzas/cobros', component: CobrosComponent },
          { path: 'finanzas/caja-general', component: CajaGeneralComponent },
        ]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FinanzasComponent);
    fixture.detectChanges();
  });

  it('muestra los dos accesos circulares y conserva su navegación', async () => {
    const router = TestBed.inject(Router);
    const cobros = fixture.nativeElement.querySelector(
      'a[href="/finanzas/cobros"]',
    ) as HTMLAnchorElement;
    const caja = fixture.nativeElement.querySelector(
      'a[href="/finanzas/caja-general"]',
    ) as HTMLAnchorElement;

    expect(cobros.textContent).toContain('Cobros');
    expect(caja.textContent).toContain('Caja');
    expect(fixture.nativeElement.querySelectorAll('.option-icon').length).toBe(2);

    cobros.click();
    await fixture.whenStable();
    expect(router.url).toBe('/finanzas/cobros');
    caja.click();
    await fixture.whenStable();
    expect(router.url).toBe('/finanzas/caja-general');
  });
});
