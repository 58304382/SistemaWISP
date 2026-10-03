import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/services/auth.service';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let allowedModules: Set<string>;

  beforeEach(async () => {
    allowedModules = new Set();
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: vi.fn().mockReturnValue({
              nombre: 'Ana',
              apellido: 'López',
              username: 'alopez',
            }),
            hasModule: (code: string) => allowedModules.has(code),
            isAdministrator: vi.fn().mockReturnValue(false),
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SidebarComponent);
  });

  it('muestra Mapas únicamente con el permiso mapas', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/mapas"]')).toBeNull();

    fixture.destroy();
    allowedModules.add('mapas');
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/mapas"]')?.textContent).toContain('Mapas');
  });
});
