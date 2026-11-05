// ==========================================
// IMPORTS
// ==========================================
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, TimeoutError, catchError, finalize, switchMap } from 'rxjs';

import { getApiErrorMessage } from '../../core/utils/api-error';
import { AuthService } from './services/auth.service';

// ==========================================
// COMPONENTE LOGIN
// ==========================================
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  // ==========================================
  // DEPENDENCIAS Y ESTADO
  // ==========================================
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly errorMessage = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  private readonly returnUrl = this.safeReturnUrl(
    this.route.snapshot.queryParamMap.get('returnUrl'),
  );

  // ==========================================
  // CICLO DE VIDA
  // ==========================================
  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('reason') === 'expired') {
      this.errorMessage.set('Tu sesión expiró. Inicia sesión nuevamente.');
    }
  }

  // ==========================================
  // AUTENTICACION
  // ==========================================
  submit(): void {
    // Evita peticiones simultáneas que compitan por el token y el estado de carga.
    if (this.isLoading()) return;
    this.errorMessage.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.auth
      .login(this.form.getRawValue())
      .pipe(
        switchMap(() =>
          this.auth.loadCurrentUser().pipe(
            // /me es una ruta protegida: su 401 no significa credenciales incorrectas.
            catchError((error: unknown) => {
              // Un token sin /me validado no constituye un login completado.
              this.auth.clearSession();
              this.errorMessage.set(
                error instanceof TimeoutError
                  ? 'El servidor tardó demasiado en validar la sesión. Inténtalo nuevamente.'
                  : getApiErrorMessage(error),
              );
              return EMPTY;
            }),
          ),
        ),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe({
        next: () => void this.router.navigateByUrl(this.returnUrl),
        error: (error: unknown) => {
          this.errorMessage.set(this.getLoginErrorMessage(error));
        },
      });
  }

  // ==========================================
  // VISIBILIDAD DE CONTRASEÑA
  // ==========================================
  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  // ==========================================
  // UTILIDADES Y MENSAJES
  // ==========================================
  private safeReturnUrl(value: string | null): string {
    return value?.startsWith('/') && !value.startsWith('//') && value !== '/login'
      ? value
      : '/inicio';
  }

  private getLoginErrorMessage(error: unknown): string {
    if (error instanceof TimeoutError) {
      return 'El servidor tardó demasiado en responder. Comprueba la conexión e inténtalo nuevamente.';
    }
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Usuario o contraseña incorrectos.';
    }
    return getApiErrorMessage(error, 'No fue posible iniciar sesión. Inténtalo nuevamente.');
  }
}
