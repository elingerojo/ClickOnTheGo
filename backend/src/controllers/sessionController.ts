/**
 * Autenticación multi-dispositivo (plan 03-auth-device-tokens.md).
 *  - POST /api/auth/one-time-token  (protegido con ADMIN_TOKEN)
 *  - POST /api/auth/exchange        (público, canjea token single-use por
 *                                    token de dispositivo)
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { hashToken } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { audit } from '../services/auditService.js';

export async function generateOneTimeToken(_req: Request, res: Response): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO one_time_tokens (token) VALUES ($1)', [token]);
  const { rows } = await query('SELECT count(*)::int AS n FROM devices WHERE revoked_at IS NULL');
  const link = `${env.appBaseUrl}/auth?token=${token}`;
  await audit('auth:one-time-token', {});
  res.status(201).json({
    token,
    link,
    devicesActive: Number(rows[0]?.n ?? 0),
  });
}

export async function exchange(req: Request, res: Response): Promise<void> {
  // El token llega normalmente en el body; también se acepta en el query string
  // (como viaja en el link de invitación) como fallback robusto cuando el
  // parser de JSON no deja pasar el body.
  const bodyToken = (req.body as { token?: unknown } | undefined)?.token;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = typeof bodyToken === 'string' ? bodyToken : queryToken;

  if (!token || token.length < 10) {
    // Diagnóstico: registrar exactamente qué llegó para depurar en logs
    console.warn('[auth] exchange: sin token', {
      contentType: req.headers['content-type'],
      hasBody: Boolean(req.body),
      bodyKeys: req.body ? Object.keys(req.body as object) : [],
      hasQueryToken: Boolean(queryToken),
    });
    res.status(400).json({
      error: 'Falta el token de un solo uso (en el body o en el query string)',
      code: 'INVALID_BODY',
    });
    return;
  }

  const rawDeviceName = (req.body as { deviceName?: unknown } | undefined)?.deviceName;
  const deviceName = typeof rawDeviceName === 'string' ? rawDeviceName : undefined;
  const deviceToken = randomBytes(32).toString('hex');
  try {
    const deviceId = await withTransaction(async (client) => {
      // Marca el token de un solo uso en la MISMA transacción (evita doble canje)
      const used = await client.query(
        `UPDATE one_time_tokens SET used_at = now()
          WHERE token = $1 AND used_at IS NULL
          RETURNING token`,
        [token],
      );
      if (used.rows.length === 0) {
        throw new HttpError(
          400,
          'Token de un solo uso inválido o ya utilizado. Genera uno nuevo.',
          'INVALID_OR_USED_TOKEN',
        );
      }
      const inserted = await client.query(
        `INSERT INTO devices (token, name)
         VALUES ($1, $2)
         RETURNING id`,
        [hashToken(deviceToken), deviceName ?? 'Dispositivo nuevo'],
      );
      return inserted.rows[0].id as string;
    });
    await audit('auth:device-added', { deviceId });
    res.status(201).json({ deviceToken, deviceId });
  } catch (err) {
    if (err instanceof HttpError && err.code === 'INVALID_OR_USED_TOKEN') {
      console.warn(
        '[auth] exchange: token rechazado (inválido o ya usado)',
        { tokenPreview: `${token.slice(0, 6)}…${token.slice(-4)}` },
      );
    }
    throw err;
  }
}
