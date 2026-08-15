import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

/** Configuración inyectada desde `index.html` (`window.__APP_CONFIG__`). */
interface RuntimeConfig {
  apiBaseUrl?: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

export const APP_CONFIG: Required<RuntimeConfig> = {
  apiBaseUrl: window.__APP_CONFIG__?.apiBaseUrl ?? 'http://localhost:4000',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
  ],
};
