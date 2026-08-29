import type { Request, Response } from '../core/http.ts';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response
) => {
  console.error('[ServerError]', err.message);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : err.message
  });
};
