import type { Device } from '@click-on-the-go/shared';

declare global {
  namespace Express {
    interface Request {
      /** Dispositivo autenticado vía middleware `requireDevice`. */
      device?: Pick<Device, 'id' | 'name'>;
    }
  }
}

export {};
