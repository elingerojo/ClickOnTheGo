/** Settings globales + dispositivos + invitación + GC. */
import { api } from './api';
import type {
  AppSettings,
  Device,
  GcResult,
  InvitationResponse,
  SettingsUpdate,
} from '@click-on-the-go/shared';

export function getSettings(): Promise<AppSettings> {
  return api<AppSettings>('/api/settings');
}

export function putSettings(update: SettingsUpdate): Promise<AppSettings> {
  return api<AppSettings>('/api/settings', { method: 'PUT', body: update });
}

export function refreshSettings(): Promise<AppSettings> {
  return api<AppSettings>('/api/settings/refresh', { method: 'POST' });
}

export function runGc(): Promise<GcResult> {
  return api<GcResult>('/api/gc/run', { method: 'POST' });
}

export function listDevices(): Promise<{ devices: Device[]; selfId?: string | null }> {
  return api<{ devices: Device[]; selfId?: string | null }>('/api/devices');
}

/**
 * Devuelve la invitación activa del dispositivo actual (genera una si hace falta).
 * Con `regenerate=true` invalida la anterior y crea una nueva.
 */
export function getMyInvitation(regenerate = false): Promise<InvitationResponse> {
  return api<InvitationResponse>(
    `/api/devices/me/invitation${regenerate ? '?regenerate=1' : ''}`,
  );
}

export function revokeDevice(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/devices/${id}/revoke`, { method: 'POST' });
}
