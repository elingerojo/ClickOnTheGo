/**
 * Dispositivos: listar, invalidar OTRO dispositivo (no a sí mismo) y gestionar
 * la invitación activa del dispositivo actual (QR de Settings).
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { audit } from '../services/auditService.js';
import { invitationIdentity } from '@click-on-the-go/shared';
import type { Device, InvitationResponse } from '@click-on-the-go/shared';

/** Días de validez de la invitación QR (caducidad dura en el exchange). */
const TTL_MS = env.invitationTtlDays * 86_400_000;

function rowToDevice(row: any): Device {
  return {
    id: row.id,
    name: row.name ?? null,
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function list(req: Request, res: Response): Promise<void> {
  const { rows } = await query(
    'SELECT id, name, last_seen_at, revoked_at, created_at FROM devices ORDER BY created_at ASC',
  );
  // `selfId` permite al frontend ocultar el dispositivo actual y así evitar
  // que se invalide a sí mismo (el token va hasheado, no se puede derivar el id).
  res.json({ devices: rows.map(rowToDevice), selfId: req.device?.id ?? null });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const selfId = req.device?.id;
  if (id === selfId) {
    throw new HttpError(400, 'No puedes invalidar tu propio dispositivo');
  }
  const { rows } = await query(
    `UPDATE devices
        SET revoked_at = now(), revoked_by = $1
      WHERE id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [selfId, id],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'Dispositivo no encontrado o ya invalidado');
  }
  await audit('device:revoked', { deviceId: id, by: selfId });
  res.json({ ok: true });
}

/**
 * GET /api/devices/me/invitation — devuelve (y genera si hace falta) la invitación
 * activa del dispositivo actual.
 * - Reusa la guardada si sigue sin usar y sin vencer (cero crecimiento en Neon).
 * - Con `?regenerate=1` marca la actual como usada y genera una nueva.
 */
export async function getMyInvitation(req: Request, res: Response): Promise<void> {
  const deviceId = req.device?.id;
  if (!deviceId) {
    res.status(401).json({ error: 'Sin dispositivo autenticado' });
    return;
  }
  const forceRegenerate =
    req.query.regenerate === '1' || req.query.regenerate === 'true';

  const invitation = await withTransaction(async (client) => {
    // Bloquea la fila del device para serializar dos generaciones concurrentes.
    const { rows } = await client.query(
      'SELECT last_unused_one_time_token FROM devices WHERE id = $1 FOR UPDATE',
      [deviceId],
    );
    const current = (rows[0]?.last_unused_one_time_token as string | null) ?? null;

    // Reuso: si existe, está sin usar y sin vencer → se devuelve tal cual.
    if (!forceRegenerate && current) {
      const ot = await client.query(
        'SELECT created_at FROM one_time_tokens WHERE token = $1 AND used_at IS NULL',
        [current],
      );
      if (ot.rows.length > 0) {
        const createdAt = new Date(ot.rows[0].created_at as Date).getTime();
        if (Date.now() - createdAt < TTL_MS) return buildInvitation(current);
      }
    }

    // Invalida la actual (ya usada, vencida o regeneración manual).
    if (current) {
      await client.query(
        'UPDATE one_time_tokens SET used_at = now() WHERE token = $1 AND used_at IS NULL',
        [current],
      );
    }

    // Genera una nueva y la guarda como invitación activa del device.
    const token = randomBytes(32).toString('hex');
    await client.query('INSERT INTO one_time_tokens (token) VALUES ($1)', [token]);
    await client.query('UPDATE devices SET last_unused_one_time_token = $1 WHERE id = $2', [
      token,
      deviceId,
    ]);
    return buildInvitation(token);
  });

  await audit('invitation:viewed', { deviceId, regenerate: forceRegenerate });
  res.json(invitation);
}

function buildInvitation(token: string): InvitationResponse {
  const { word, emoji } = invitationIdentity(token);
  return {
    link: `${env.appBaseUrl}/auth?token=${token}`,
    token,
    word,
    emoji,
  };
}
