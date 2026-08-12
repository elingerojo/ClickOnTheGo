/**
 * Dispositivos: listar e invalidar OTRO dispositivo (no a sí mismo).
 */
import type { Request, Response } from 'express';
import { query } from '../config/db.js';
import { HttpError } from '../utils/httpError.js';
import { audit } from '../services/auditService.js';
import type { Device } from '@click-on-the-go/shared';

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
