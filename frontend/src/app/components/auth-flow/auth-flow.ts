import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { exchangeOneTimeToken } from '../../services/auth';
import { setSession, isAuthenticated } from '../../services/session';
import { ApiError } from '../../services/api';

@Component({
  selector: 'app-auth-flow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="max-w-md mx-auto mt-16 bg-white rounded-2xl shadow p-8 text-center">
      <div class="text-5xl mb-4">🔐</div>
      <h1 class="text-xl font-bold mb-2">Autenticación de dispositivo</h1>

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
  status: 'exchanging' | 'ok' | 'error' | 'none' = 'none';
  error = '';
  errorCode = '';
  isAuthenticated = isAuthenticated;

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) return;
    this.status = 'exchanging';
    exchangeOneTimeToken(token, deviceName())
      .then((res) => {
        setSession(res.deviceToken);
        this.status = 'ok';
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
