/**
 * Autenticación:
 * - `requireAdmin`: protege la generación de tokens de un solo uso
 *   (password en env `ADMIN_TOKEN`).
 * - `requireDevice`: exige un token de dispositivo válido (cabecera
 *   `X-Device-Token` o query `?token=` para SSE). El token se guarda
 *   hasheado (sha256) en `devices`.
 */
import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header =
    req.header('x-admin-token') ?? req.header('authorization') ?? '';
  const expected = env.adminToken;
  if (!expected || !safeEqual(header, expected)) {
    res.status(401).json({ error: 'No autorizado. Falta X-Admin-Token válido.' });
    return;
  }
  next();
}

export async function requireDevice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token =
    req.header('x-device-token') ??
    (typeof req.query.token === 'string' ? req.query.token : '');
  // TEMP-DEBUG (quitar antes del release): token que llega al backend (visible en Railway).
  console.warn('[TEMP-DEBUG] requireDevice →', {
    token,
    url: req.originalUrl,
  });
  if (!token) {
    res.status(401).json({ error: 'Falta X-Device-Token' });
    return;
  }
  try {
    const { rows } = await query(
      'SELECT id, name FROM devices WHERE token = $1 AND revoked_at IS NULL',
      [hashToken(token)],
    );
    if (rows.length === 0) {
      res.status(401).json({ error: 'Dispositivo no válido o revocado' });
      return;
    }
    req.device = { id: rows[0].id, name: rows[0].name };
    // Actualizar last_seen (fire and forget)
    query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [rows[0].id]).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

/** Valida un token de dispositivo sin adjuntarlo al request (para Blob upload). */
export async function isValidDeviceToken(token: string): Promise<boolean> {
  if (!token) return false;
  const { rows } = await query(
    'SELECT id FROM devices WHERE token = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
  return rows.length > 0;
}
