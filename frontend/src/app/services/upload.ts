/**
 * Subida DIRECTA a Vercel Blob desde el navegador (sin pasar el archivo por el
 * backend). Usa `upload()` de `@vercel/blob/client` (v2):
 *   1. POSTea a `handleUploadUrl` (`/api/upload/token`) para obtener un
 *      `clientToken`; el servidor valida el device token (cabecera y
 *      clientPayload).
 *   2. El navegador hace el PUT directo al almacenamiento y recibe la URL.
 */
import { upload } from '@vercel/blob/client';
import { APP_CONFIG } from '../app.config';
import { getDeviceToken } from './api';

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(`La imagen ${file.name} supera los 10 MB.`);
  }
  const deviceToken = getDeviceToken();
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pathname = `products/${crypto.randomUUID()}-${Date.now()}.${ext}`;

  const result = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: `${APP_CONFIG.apiBaseUrl}/api/upload/token`,
    clientPayload: JSON.stringify({ token: deviceToken }),
    headers: deviceToken ? { 'X-Device-Token': deviceToken } : undefined,
    contentType: file.type || 'image/jpeg',
  });

  return result.url;
}
