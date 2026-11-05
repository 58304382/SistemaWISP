// ==========================================
// IMPORTS
// ==========================================
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../features/auth/services/auth.service';

// ==========================================
// COMPONENTE Y ESTADO DEL SIDEBAR
// ==========================================
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  readonly clientsExpanded = signal(true);
  readonly tabletExpanded = signal(false);

  @Input() mobileOpen = false;
  @Output() readonly closeRequested = new EventEmitter<void>();
  @Output() readonly tabletExpandedChange = new EventEmitter<boolean>();
  @ViewChild('mobileCloseButton') private mobileCloseButton?: ElementRef<HTMLButtonElement>;

  // ==========================================
  // INFORMACION DEL USUARIO AUTENTICADO
  // ==========================================
  readonly displayName = () => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre} ${user.apellido}`.trim() : 'Usuario';
  };

  readonly initials = () => {
    const user = this.auth.currentUser();
    return user ? `${user.nombre.charAt(0)}${user.apellido.charAt(0)}`.toUpperCase() : 'U';
  };

  // ==========================================
  // METODOS DE NAVEGACION
  // ==========================================
  toggleClients(): void {
    this.clientsExpanded.update((expanded) => !expanded);
  }

  toggleTablet(): void {
    this.tabletExpanded.update((expanded) => !expanded);
    this.tabletExpandedChange.emit(this.tabletExpanded());
  }

  collapseTablet(): void {
    if (this.tabletExpanded()) {
      this.tabletExpanded.set(false);
      this.tabletExpandedChange.emit(false);
    }
  }

  focusMobileCloseButton(): void {
    this.mobileCloseButton?.nativeElement.focus();
  }

  closeAfterNavigation(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a')) {
      this.collapseTablet();
      this.closeRequested.emit();
    }
  }

  // Mantiene el foco dentro del drawer mientras cubre el contenido en teléfonos.
  @HostListener('keydown.tab', ['$event'])
  trapMobileFocus(event: Event): void {
    if (!this.host.nativeElement.classList.contains('mobile-open')) {
      return;
    }

    const keyboardEvent = event as KeyboardEvent;

    const focusable = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      return;
    }

    if (keyboardEvent.shiftKey && document.activeElement === first) {
      keyboardEvent.preventDefault();
      last.focus();
    } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
      keyboardEvent.preventDefault();
      first.focus();
    }
  }
}
