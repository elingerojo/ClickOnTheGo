/**
 * Bus SSE (Server-Sent Events).
 * - Mantiene la lista de clientes conectados.
 * - Buffer circular en memoria con el historial reciente para que los
 *   clientes nuevos recuperen el estado al conectarse.
 * - `emit(event)` publica a todos los clientes.
 */
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { SseEvent } from '@click-on-the-go/shared';

interface SseClient {
  id: string;
  res: Response;
  heartbeat: NodeJS.Timeout;
}

const HEARTBEAT_MS = 25_000;
const MAX_BUFFER = 200;

class SseBus {
  private readonly clients = new Map<string, SseClient>();
  private readonly buffer: SseEvent[] = [];

  get clientCount(): number {
    return this.clients.size;
  }

  /** Anexa una respuesta HTTP como cliente SSE y reproduce el buffer. */
  attach(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const id = randomUUID();
    const heartbeat = setInterval(() => this.sendRaw(res, ': ping\n\n'), HEARTBEAT_MS);
    const client: SseClient = { id, res, heartbeat };
    this.clients.set(id, client);

    // Replay del historial reciente
    for (const event of this.buffer) {
      this.sendTo(res, event);
    }

    res.on('close', () => this.remove(id));
  }

  /** Publica un evento a todos los clientes y lo guarda en el buffer. */
  emit(event: SseEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    for (const client of this.clients.values()) {
      this.sendTo(client.res, event);
    }
  }

  private sendTo(res: Response, event: SseEvent): void {
    this.sendRaw(res, `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  private sendRaw(res: Response, chunk: string): void {
    res.write(chunk);
  }

  private remove(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    clearInterval(client.heartbeat);
    this.clients.delete(id);
  }
}

export const sseBus = new SseBus();
