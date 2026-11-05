import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../features/auth/services/auth.service';
import { AppShellComponent } from './app-shell.component';

@Component({ template: '' })
class TestPageComponent {}

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([{ path: 'destino', component: TestPageComponent }]),
        {
          provide: AuthService,
          useValue: {
            currentUser: vi.fn().mockReturnValue({
              nombre: 'Ana',
              apellido: 'López',
              username: 'alopez',
            }),
            hasModule: vi.fn().mockReturnValue(false),
            isAdministrator: vi.fn().mockReturnValue(false),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('abre el drawer desde el encabezado y lo cierra desde el fondo exterior', () => {
    const menuButton = fixture.nativeElement.querySelector('.mobile-menu-button');
    menuButton.click();
    fixture.detectChanges();

    expect(component.mobileNavigationOpen()).toBe(true);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');

    fixture.nativeElement.querySelector('.mobile-backdrop').click();
    fixture.detectChanges();

    expect(component.mobileNavigationOpen()).toBe(false);
  });

  it('cierra el drawer desde el botón del sidebar y con Escape', () => {
    component.openMobileNavigation();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.mobile-close-button').click();

    expect(component.mobileNavigationOpen()).toBe(false);

    component.openMobileNavigation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.mobileNavigationOpen()).toBe(false);
  });

  it('cierra el drawer cuando finaliza una navegación', async () => {
    component.openMobileNavigation();

    await TestBed.inject(Router).navigateByUrl('/destino');

    expect(component.mobileNavigationOpen()).toBe(false);
  });

  it('cierra el drawer al pulsar una ruta aunque la navegación no finalice', () => {
    component.openMobileNavigation();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('a[href="/inicio"]').click();

    expect(component.mobileNavigationOpen()).toBe(false);
  });
});
