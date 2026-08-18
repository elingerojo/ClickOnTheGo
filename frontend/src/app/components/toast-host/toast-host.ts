import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { dismiss, toasts } from '../../services/toast';

/**
 * Host visual de toasts (F7) — siempre montado en `AppComponent`.
 * Posición fija top-right, estilos Tailwind y animación de entrada.
 * El contenedor es `pointer-events-none` para no bloquear la UI; cada toast
 * recupera los eventos (`pointer-events-auto`) para su botón de cierre.
 */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      <div
        *ngFor="let t of toasts()"
        class="toast-item pointer-events-auto rounded-xl shadow-lg px-4 py-3 text-sm font-medium text-white flex items-start justify-between gap-3"
        [class]="t.type === 'success' ? 'bg-emerald-600' : (t.type === 'error' ? 'bg-red-600' : 'bg-slate-800')"
        role="status"
      >
        <span class="leading-snug">{{ t.message }}</span>
        <button
          (click)="dismiss(t.id)"
          class="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none"
          aria-label="Cerrar"
        >×</button>
      </div>
    </div>
  `,
  styles: [
    `
      @keyframes toast-in {
        from { opacity: 0; transform: translateX(1rem); }
        to { opacity: 1; transform: translateX(0); }
      }
      .toast-item {
        animation: toast-in 0.2s ease-out;
      }
    `,
  ],
})
export class ToastHostComponent {
  toasts = toasts;
  dismiss = dismiss;
}
