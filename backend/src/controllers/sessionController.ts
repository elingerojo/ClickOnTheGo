/**
 * Autenticación multi-dispositivo (plan 03-auth-device-tokens.md).
 *  - POST /api/auth/one-time-token  (protegido con ADMIN_TOKEN)
 *  - POST /api/auth/exchange        (público, canjea token single-use por
 *                                    token de dispositivo)
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
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

const exchangeSchema = z.object({
  token: z.string().min(10),
  deviceName: z.string().max(100).optional(),
});

export async function exchange(req: Request, res: Response): Promise<void> {
  const parsed = exchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body inválido: falta token' });
    return;
  }
  const { token, deviceName } = parsed.data;
  const deviceToken = randomBytes(32).toString('hex');
  const deviceId = await withTransaction(async (client) => {
    // Marca el token de un solo uso en la MISMA transacción (evita doble canje)
    const used = await client.query(
      `UPDATE one_time_tokens SET used_at = now()
        WHERE token = $1 AND used_at IS NULL
        RETURNING token`,
      [token],
    );
    if (used.rows.length === 0) {
      throw new HttpError(400, 'Token de un solo uso inválido o ya utilizado');
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
}
