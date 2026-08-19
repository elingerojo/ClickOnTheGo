/**
 * Token de subida directa a Vercel Blob (solo imágenes jpeg/png/webp, máx 10 MB).
 * El frontend sube el archivo directo al Blob sin pasar por el backend.
 *
 * NOTA: @vercel/blob v2 — `handleUpload` vive en `@vercel/blob/client` y se usa
 * del lado del servidor. El cliente POSTea un JSON `{ type, payload }`; el
 * servidor valida y devuelve el `clientToken` para que el navegador haga el
 * PUT directo al almacenamiento. El device token viaja en el `clientPayload`.
 */
import type { Request, Response } from 'express';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { env } from '../config/env.js';
import { isValidDeviceToken } from '../middleware/auth.js';

// Incluye HEIC/HEIF (formato High Efficiency del iPhone) para que la subida
// directa no sea rechazada cuando la cámara entrega archivos .heic/.heif.
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function uploadToken(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as HandleUploadBody;

    // [DEBUG] Diagnóstico Vercel Blob — qué llega al endpoint de token (quitar antes del release)
    const payload = (body as { payload?: Record<string, unknown> })?.payload;
    console.warn('[DEBUG upload] POST /api/upload/token →', {
      type: (body as { type?: string })?.type,
      payload: {
        pathname: typeof payload?.pathname === 'string' ? payload.pathname : undefined,
        hasClientPayload: typeof payload?.clientPayload === 'string',
        multipart: payload?.multipart,
        contentType: payload?.contentType,
      },
      blobToken: {
        set: Boolean(env.blobReadWriteToken),
        length: env.blobReadWriteToken?.length ?? 0,
        prefix: env.blobReadWriteToken ? env.blobReadWriteToken.slice(0, 15) : '(vacío)',
      },
    });

    const response = await handleUpload({
      body,
      // Express req cubre `url` y `headers` que handleUpload necesita
      request: req as unknown as Request,
      token: env.blobReadWriteToken,
      onBeforeGenerateToken: async (_pathname: string, clientPayload: string | null) => {
        // El device token viaja en el clientPayload del upload del navegador
        let token = '';
        try {
          token = (JSON.parse(clientPayload ?? '{}') as { token?: string })?.token ?? '';
        } catch {
          token = '';
        }
        const valid = await isValidDeviceToken(token);
        // [DEBUG] Diagnóstico Vercel Blob — validación del device token (quitar antes del release)
        console.warn('[DEBUG upload] onBeforeGenerateToken →', {
          deviceTokenPresent: Boolean(token),
          deviceTokenValid: valid,
        });
        if (!valid) {
          throw new Error('No autorizado: dispositivo no válido');
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_SIZE_BYTES,
        };
      },
    });
    res.json(response);
  } catch (err: any) {
    // [DEBUG] Diagnóstico Vercel Blob — error completo (quitar antes del release)
    console.error('[upload] Error generando token (DETAIL):', {
      message: err?.message,
      name: err?.name,
      cause: err?.cause?.message ?? err?.cause,
      stack: err?.stack,
    });
    res.status(400).json({
      error:
        'No se pudo generar el token de subida. Solo imágenes jpeg/png/webp y máx 10 MB.',
    });
  }
}
