/**
 * Construcción de la aplicación Express + rutas + worker + shutdown.
 * Importada dinámicamente desde `index.ts` (después de cargar el env).
 */
import express from 'express';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { env } from './config/env.js';
import { closePool } from './config/db.js';
import { getWixClient } from './config/wixClient.js';
import { requireAdmin, requireDevice } from './middleware/auth.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { HttpError } from './utils/httpError.js';

// Controllers
import { stream } from './controllers/eventsController.js';
import { uploadToken } from './controllers/uploadController.js';
import { analyze } from './controllers/analyzeController.js';
import * as catalogController from './controllers/catalogController.js';
import * as productsController from './controllers/productsController.js';
import * as jobsController from './controllers/jobsController.js';
import * as settingsController from './controllers/settingsController.js';
import * as sessionController from './controllers/sessionController.js';
import * as devicesController from './controllers/devicesController.js';
import { run as runGc } from './controllers/gcController.js';

// Worker
import { startWorker, stopWorker } from './services/workerService.js';

export async function startServer(): Promise<void> {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, wix: getWixClient().mode, ts: new Date().toISOString() });
  });

  /* ------------------- Auth de dispositivos ------------------- */
  app.post(
    '/api/auth/one-time-token',
    requireAdmin,
    asyncHandler(sessionController.generateOneTimeToken),
  );
  app.post('/api/auth/exchange', asyncHandler(sessionController.exchange));
  app.get('/api/auth/validate', asyncHandler(sessionController.validateDevice));

  /* ------------------- SSE (device token por query) ------------ */
  app.get('/api/events', requireDevice, stream);

  /* ------------------- Rutas protegidas por device ------------ */
  app.post('/api/upload/token', requireDevice, asyncHandler(uploadToken));
  app.post('/api/analyze', requireDevice, asyncHandler(analyze));
  app.post('/api/products', requireDevice, asyncHandler(productsController.create));
  app.get('/api/products', requireDevice, asyncHandler(productsController.list));
  app.post('/api/products/:id/approve', requireDevice, asyncHandler(productsController.approve));
  app.get('/api/jobs', requireDevice, asyncHandler(jobsController.list));
  app.post('/api/jobs/:id/retry', requireDevice, asyncHandler(jobsController.retry));
  app.get('/api/settings', requireDevice, asyncHandler(settingsController.get));
  app.put('/api/settings', requireDevice, asyncHandler(settingsController.update));
  app.post('/api/settings/refresh', requireDevice, asyncHandler(settingsController.refresh));
  app.post('/api/gc/run', requireDevice, asyncHandler(runGc));

  // Referencias Wix para el frontend (sync Wix → Neon + lista)
  app.get('/api/categories', requireDevice, asyncHandler(catalogController.categories));
  app.get('/api/brands', requireDevice, asyncHandler(catalogController.brands));

  app.get('/api/devices', requireDevice, asyncHandler(devicesController.list));
  // Ruta fija antes de :id para que "me" no se interprete como un id.
  app.get(
    '/api/devices/me/invitation',
    requireDevice,
    asyncHandler(devicesController.getMyInvitation),
  );
  app.post('/api/devices/:id/revoke', requireDevice, asyncHandler(devicesController.revoke));

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  // Manejo central de errores
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Error del parser de body (express.json): JSON inválido/truncado
    const e = err as { type?: string; message?: string };
    if (e?.type === 'entity.parse.failed') {
      console.warn('[server] Body JSON inválido:', { url: req.url, message: e.message });
      res.status(400).json({ error: 'JSON inválido en el body', code: 'INVALID_JSON' });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[server] Error no manejado:', message);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  const port = env.port;
  const server = app.listen(port, () => {
    console.log(`[server] Backend escuchando en ${env.backendPublicUrl} (puerto ${port})`);
  });

  // Worker de la cola (se desactiva con WORKER_DISABLED=1)
  if (process.env.WORKER_DISABLED !== '1') {
    startWorker();
  } else {
    console.log('[worker] Desactivado (WORKER_DISABLED=1).');
  }

  // Shutdown limpio
  const shutdown = async () => {
    console.log('[server] Apagando...');
    stopWorker();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
