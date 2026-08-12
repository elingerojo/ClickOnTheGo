/**
 * Endpoint SSE: GET /api/events (requiere device token por query param,
 * porque `EventSource` no puede enviar cabeceras personalizadas).
 */
import type { Request, Response } from 'express';
import { sseBus } from '../config/sse.js';

export function stream(_req: Request, res: Response): void {
  sseBus.attach(res);
}
