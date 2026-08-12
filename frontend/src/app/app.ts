import { Component, OnInit } from '@angular/core';
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
            <a routerLink="/settings" routerLinkActive="bg-brand-600"
               class="px-3 py-2 rounded text-sm hover:bg-brand-600">Settings</a>
          </div>
          <button (click)="onLogout()" class="text-sm px-3 py-1.5 rounded bg-brand-600 hover:bg-brand-500">
            Cerrar sesión
          </button>
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

  ngOnInit(): void {
    initSession();
  }

  onLogout(): void {
    clearSession();
    window.location.href = '/auth';
  }
}
