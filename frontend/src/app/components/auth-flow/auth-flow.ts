import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { exchangeOneTimeToken, validateDeviceToken } from '../../services/auth';
import {
  initSession,
  isAuthenticated,
  setSession,
  deviceToken,
  clearSession,
} from '../../services/session';
import { ApiError, storageAvailable } from '../../services/api';
import { invitationIdentity } from '@click-on-the-go/shared';

@Component({
  selector: 'app-auth-flow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="max-w-md mx-auto mt-16 bg-white rounded-2xl shadow p-8 text-center">
      <div class="text-5xl mb-4">🔐</div>
      <h1 class="text-xl font-bold mb-2">Autenticación de dispositivo</h1>

      <div *ngIf="identity() as id" class="text-sm bg-brand-50 text-brand-800 rounded-lg p-3 mb-4">
        Esta invitación es:
        <div class="flex items-center justify-center gap-2 mt-1 text-2xl font-bold capitalize">
          <span aria-hidden="true">{{ id.emoji }}</span><span>{{ id.word }}</span>
        </div>
        <p class="text-xs text-brand-700 mt-1">Confirma con el anfitrión la palabra y el icono para
          asegurar que la invitación sigue siendo la misma.</p>
      </div>

      <ng-container *ngIf="status === 'validating'">
        <p class="text-slate-500">Verificando sesión guardada…</p>
        <div class="mt-4 inline-block h-8 w-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      </ng-container>

      <ng-container *ngIf="status === 'exchanging'">
        <p class="text-slate-500">Canjeando token de un solo uso…</p>
        <div class="mt-4 inline-block h-8 w-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      </ng-container>

      <ng-container *ngIf="status === 'ok'">
        <p class="text-emerald-600 font-semibold mb-4">✅ Dispositivo autenticado correctamente.</p>
        <button (click)="goHome()" class="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
          Ir a la app
        </button>
      </ng-container>

      <ng-container *ngIf="status === 'error'">
        <p class="text-red-600 font-semibold mb-2">❌ {{ error }}</p>

        <!-- Caso específico: token ya usado / inválido -->
        <ng-container *ngIf="errorCode === 'INVALID_OR_USED_TOKEN'">
          <p class="text-sm text-slate-500 mb-3">
            Este token de un solo uso <strong>ya fue utilizado o no existe</strong>
            en la base de datos. Cada token solo sirve para un dispositivo.
          </p>
          <p class="text-sm bg-amber-50 text-amber-800 rounded-lg p-3">
            💡 Genera un token <strong>nuevo</strong> desde la terminal
            (<code>npm run db:token -w @click-on-the-go/backend</code>) y abre el
            link nuevo en este dispositivo.
          </p>
        </ng-container>

        <!-- Caso genérico -->
        <p *ngIf="errorCode !== 'INVALID_OR_USED_TOKEN'" class="text-sm text-slate-500">
          Genera un token de un solo uso desde la terminal
          (<code>npm run db:token -w @click-on-the-go/backend</code>) y abre el link
          en este dispositivo.
        </p>
      </ng-container>

      <ng-container *ngIf="status === 'none'">
        <p class="text-slate-500 mb-4">No se recibió ningún token para canjear.</p>

        <div *ngIf="!storageAvailable()" class="text-sm bg-red-50 text-red-700 rounded-lg p-3 mb-3 text-left">
          ⚠️ Este navegador tiene el <strong>almacenamiento local bloqueado o estás en modo
          incógnito/privado</strong>. Sin localStorage no se puede guardar el token de sesión y
          la sesión se perderá al recargar. Usa un navegador normal y desactiva el modo incógnito.
        </div>

        <div *ngIf="storageAvailable()" class="text-sm bg-amber-50 text-amber-800 rounded-lg p-3 mb-3 text-left">
          💡 ¿Ya te habías autenticado antes? La sesión se guarda en <strong>localStorage</strong> y es por
          <strong>navegador/perfil</strong>. Si entraste con otro navegador, perfil, dispositivo o en modo
          incógnito, aquí no está tu token. Abre la app en el mismo navegador donde la autenticaste, o genera
          un token nuevo con <code>npm run db:token -w @click-on-the-go/backend</code>.
        </div>

        <p class="text-sm text-slate-400 mb-6">
          Abre en este dispositivo el <strong>link de invitación</strong> que generaste
          con el script <code>db:token</code>.
        </p>
        <button *ngIf="isAuthenticated()" (click)="goHome()"
                class="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
          Ya estoy autenticado — continuar
        </button>
      </ng-container>
    </div>
  `,
})
export class AuthFlowComponent implements OnInit {
  status: 'validating' | 'exchanging' | 'ok' | 'error' | 'none' = 'none';
  error = '';
  errorCode = '';
  isAuthenticated = isAuthenticated;
  storageAvailable = storageAvailable;
  /** Identidad humana (palabra + emoji) de la invitación del URL, para compararla con el anfitrión. */
  identity = signal<{ word: string; emoji: string } | null>(null);

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) this.identity.set(invitationIdentity(token));

    // TEMP-DEBUG (quitar antes del release): estado al entrar en la página de auth.
    console.warn('[TEMP-DEBUG] auth-flow ngOnInit →', {
      urlToken: token,
      storedToken: deviceToken(),
      isAuthenticated: isAuthenticated(),
    });

    // Paso 1: intentar autentificar con la sesión guardada en localStorage.
    if (deviceToken()) {
      this.status = 'validating';
      validateDeviceToken(Boolean(token))
        .then((res) => {
          if (res.valid) {
            // Ya autenticado: la invitación del URL no tiene sentido, se ignora.
            console.info('[auth] Sesión localStorage válida; invitación ignorada', {
              hadInvitation: Boolean(token),
            });
            initSession();
            void this.router.navigate(['/']);
            return;
          }
          // El token guardado ya no es válido → limpiarlo y seguir con la invitación.
          clearSession();
          this.proceedWithInvitation(token);
        })
        .catch((err: Error) => {
          // 401 = token inválido → limpiar y usar la invitación.
          if (err instanceof ApiError && err.status === 401) {
            clearSession();
            this.proceedWithInvitation(token);
            return;
          }
          // Error de red/5xx: no destruir la sesión; intentar con la invitación igualmente.
          console.warn('[auth] No se pudo validar la sesión guardada', err);
          this.proceedWithInvitation(token);
        });
      return;
    }

    // Paso 2: sin sesión guardada → canjear la invitación si existe.
    this.proceedWithInvitation(token);
  }

  private proceedWithInvitation(token: string | null): void {
    if (!token) {
      this.status = 'none';
      return;
    }
    this.status = 'exchanging';
    exchangeOneTimeToken(token, deviceName())
      .then((res) => {
        setSession(res.deviceToken, res.deviceId);
        // La app arrancó sin token; recargar settings con la sesión nueva.
        initSession();
        // Autenticación exitosa → inicializar directo en Captura.
        void this.router.navigate(['/']);
      })
      .catch((err: Error) => {
        this.status = 'error';
        this.error = err.message;
        this.errorCode = err instanceof ApiError ? (err.code ?? '') : '';
      });
  }

  goHome(): void {
    void this.router.navigate(['/']);
  }
}

function deviceName(): string {
  try {
    return window.navigator.userAgent.slice(0, 60) || 'Dispositivo';
  } catch {
    return 'Dispositivo';
  }
}
