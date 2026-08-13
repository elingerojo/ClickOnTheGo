import { Component, ElementRef, HostListener, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { initSession, isAuthenticated, clearSession } from './services/session';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen flex flex-col">
      <header *ngIf="isAuthenticated()" class="bg-brand-700 text-white shadow">
        <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-1">
            <a routerLink="/" class="px-3 py-2 rounded font-semibold tracking-tight">
              📷 ClickOnTheGo
            </a>
            <a routerLink="/" routerLinkActive="bg-brand-600" [routerLinkActiveOptions]="{ exact: true }"
               class="px-3 py-2 rounded text-sm hover:bg-brand-600">Captura</a>
            <a routerLink="/dashboard" routerLinkActive="bg-brand-600"
               class="px-3 py-2 rounded text-sm hover:bg-brand-600">Dashboard</a>
            <a routerLink="/settings" routerLinkActive="bg-brand-600" aria-label="Settings" title="Settings"
               class="px-3 py-2 rounded text-sm hover:bg-brand-600 inline-flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                   stroke="currentColor" class="w-5 h-5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/>
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
              </svg>
            </a>
          </div>
          <div #accountMenu class="relative">
            <button type="button" (click)="toggleAccountMenu()" aria-label="Cuenta" title="Cuenta"
                    [attr.aria-expanded]="accountMenuOpen()"
                    class="inline-flex items-center justify-center p-2 rounded-full hover:bg-brand-600 transition">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                   stroke="currentColor" class="w-6 h-6" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/>
              </svg>
            </button>

            <div *ngIf="accountMenuOpen()" class="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl bg-white text-slate-700 shadow-lg ring-1 ring-slate-900/5 p-3 space-y-3">
              <button type="button" (click)="onLogout()"
                      class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                     stroke="currentColor" class="w-4 h-4" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"/>
                </svg>
                Cerrar sesión
              </button>
              <p class="text-xs text-slate-500 leading-relaxed">
                Si cierras sesión, necesitarás recibir una nueva invitación para volver a entrar.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main class="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit {
  isAuthenticated = isAuthenticated;

  /** Controla la visibilidad del popover de cuenta (ícono de usuario). */
  accountMenuOpen = signal(false);

  @ViewChild('accountMenu', { static: false }) accountMenuRef?: ElementRef<HTMLElement>;

  ngOnInit(): void {
    initSession();
  }

  /** Cierra el popover al tocar fuera del contenedor del ícono. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const el = this.accountMenuRef?.nativeElement;
    if (el && !el.contains(event.target as Node)) {
      this.accountMenuOpen.set(false);
    }
  }

  toggleAccountMenu(): void {
    this.accountMenuOpen.update((v) => !v);
  }

  onLogout(): void {
    this.accountMenuOpen.set(false);
    clearSession();
    window.location.href = '/auth';
  }
}
