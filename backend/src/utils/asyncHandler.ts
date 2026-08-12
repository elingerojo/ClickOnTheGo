/**
 * Envuelve handlers async de Express 4 para propagar rechazos al middleware
 * de error (Express 4 no captura promesas rechazadas automáticamente).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
