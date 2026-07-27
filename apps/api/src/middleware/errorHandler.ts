import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

import { logger } from '../utils/logger.js';

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as any).id;
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      requestId,
    });
    return;
  }

  logger.error('[%s] Unhandled error: %O', requestId || '-', err);

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    requestId,
  });
}
