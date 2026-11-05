// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

import { SidebarComponent } from './sidebar.component';

// ==========================================
// SHELL AUTENTICADO
// ==========================================
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, SidebarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly router = inject(Router);

  @ViewChild(SidebarComponent) private sidebar?: SidebarComponent;
  @ViewChild('mobileMenuButton') private mobileMenuButton?: ElementRef<HTMLButtonElement>;

  readonly mobileNavigationOpen = signal(false);
  readonly tabletNavigationOpen = signal(false);

  constructor() {
    // Toda navegación cierra el drawer móvil y devuelve la barra de tablet a su estado compacto.
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.closeMobileNavigation(true);
        this.sidebar?.collapseTablet();
      });
  }

  openMobileNavigation(): void {
    this.mobileNavigationOpen.set(true);
    queueMicrotask(() => this.sidebar?.focusMobileCloseButton());
  }

  closeMobileNavigation(restoreFocus = false): void {
    const wasOpen = this.mobileNavigationOpen();
    this.mobileNavigationOpen.set(false);
    if (restoreFocus && wasOpen) {
      queueMicrotask(() => this.mobileMenuButton?.nativeElement.focus());
    }
  }

  onTabletExpandedChange(expanded: boolean): void {
    this.tabletNavigationOpen.set(expanded);
  }

  closeTabletNavigation(): void {
    this.tabletNavigationOpen.set(false);
    this.sidebar?.collapseTablet();
  }

  // Libera la navegación superpuesta cuando cambia el breakpoint o se rota el dispositivo.
  @HostListener('window:resize')
  handleViewportResize(): void {
    if (window.innerWidth > 760) {
      this.closeMobileNavigation();
    }
    if (window.innerWidth <= 760 || window.innerWidth > 1199) {
      this.closeTabletNavigation();
    }
  }

  @HostListener('document:keydown.escape')
  closeNavigationWithEscape(): void {
    if (this.mobileNavigationOpen()) {
      this.closeMobileNavigation(true);
    }
    this.closeTabletNavigation();
  }
}
