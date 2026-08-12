/** Error con status HTTP para responder de forma limpia. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Código de error legible para que el frontend ramifique el mensaje. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
