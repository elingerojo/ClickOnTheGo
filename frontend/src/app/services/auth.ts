/** Servicios de autenticación multi-dispositivo. */
import { api } from './api';
import type { ExchangeResponse } from '@click-on-the-go/shared';

/** Canjea un token de un solo uso por un token de dispositivo. */
export function exchangeOneTimeToken(token: string, deviceName?: string): Promise<ExchangeResponse> {
  return api<ExchangeResponse>('/api/auth/exchange', {
    method: 'POST',
    body: { token, deviceName },
  });
}

/** (Uso desde terminal) Genera un token de un solo uso — requiere ADMIN_TOKEN. */
export function generateOneTimeToken(adminToken: string): Promise<{ token: string; link: string; devicesActive: number }> {
  return api('/api/auth/one-time-token', { method: 'POST', adminToken });
}
