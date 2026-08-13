import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { getDeviceToken } from './services/api';

export const authGuard = () => {
  // Lee el token EN VIVO de localStorage: el signal `isAuthenticated()` puede
  // quedar congelado en null si Chrome aún no restaura el almacenamiento al
  // evaluarse el módulo (segunda visita tras reiniciar el navegador).
  const token = getDeviceToken();
  // TEMP-DEBUG (quitar antes del release): decisión del guard + token guardado.
  console.warn('[TEMP-DEBUG] authGuard →', {
    isAuthenticated: Boolean(token),
    storedToken: token,
  });
  if (token) return true;
  return inject(Router).navigate(['/auth']);
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/capture/capture').then((m) => m.CaptureComponent),
  },
  {
    path: 'producto',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/product-form/product-form').then((m) => m.ProductFormComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/jobs-dashboard/jobs-dashboard').then((m) => m.JobsDashboardComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/settings/settings').then((m) => m.SettingsComponent),
  },
  { path: 'auth', loadComponent: () => import('./components/auth-flow/auth-flow').then((m) => m.AuthFlowComponent) },
  { path: '**', redirectTo: '' },
];
