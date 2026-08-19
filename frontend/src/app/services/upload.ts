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
import { getDeviceToken, SessionMissingError } from './api';
import { deviceToken } from './session';

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(`La imagen ${file.name} supera los 10 MB.`);
  }
  // Token con persistencia dual (localStorage + cookie); respaldo al signal en memoria.
  // Si no hay sesión, NO se llama al SDK: se lanza un error tipado para que la UI
  // muestre un mensaje claro y el CTA de reautenticación (en vez del críptico
  // "Vercel Blob: Failed to retrieve the client token").
  const tokenValue = getDeviceToken() ?? deviceToken();
  if (!tokenValue) {
    throw new SessionMissingError(
      'No hay una sesión de dispositivo válida. Reautentícate con una invitación.',
    );
  }
  const handleUploadUrl = `${APP_CONFIG.apiBaseUrl}/api/upload/token`;

  // [DEBUG] Diagnóstico Vercel Blob — estado del request antes de subir (quitar antes del release)
  console.warn('[DEBUG upload] pre-pathname →', {
    fileName: file.name,
    fileType: file.type || '(sin type)',
    fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
    handleUploadUrl,
    deviceTokenPresent: true,
    cryptoRandomUUIDAvailable: typeof globalThis.crypto?.randomUUID === 'function',
  });

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pathname = `products/${globalThis.crypto.randomUUID()}-${Date.now()}.${ext}`;
  const contentType = file.type || 'image/jpeg';

  console.warn('[DEBUG upload] subiendo →', { pathname, contentType });

  try {
    const result = await upload(pathname, file, {
      access: 'public',
      handleUploadUrl,
      clientPayload: JSON.stringify({ token: tokenValue }),
      headers: { 'X-Device-Token': tokenValue },
      contentType,
    });
    return result.url;
  } catch (err) {
    // [DEBUG] Diagnóstico Vercel Blob — reproduce el POST al endpoint de token para
    // capturar el status/body exactos que causan "Failed to retrieve the client token".
    try {
      const event = {
        type: 'blob.generate-client-token',
        payload: {
          pathname,
          clientPayload: JSON.stringify({ token: tokenValue }),
          multipart: false,
        },
      };
      const res = await fetch(handleUploadUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Device-Token': tokenValue,
        },
        body: JSON.stringify(event),
      });
      const text = await res.text();
      console.warn('[DEBUG upload] token endpoint →', {
        status: res.status,
        ok: res.ok,
        body: text.slice(0, 500),
      });
    } catch (diagErr) {
      console.warn('[DEBUG upload] fallo en fetch diagnóstico:', diagErr);
    }
    throw err;
  }
}
