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

// Map the Prisma error codes we actually surface to callers into clean HTTP statuses with
// generic, non-leaky messages. Without this every constraint violation fell through to the
// 500 branch and (outside production) echoed the raw Prisma message — table/column names,
// constraint identifiers and all (FZ-022).
function mapPrismaError(err: any): { status: number; message: string } | null {
  // PrismaClientValidationError has no `code`; it means the query shape was wrong (bad input).
  if (err?.name === 'PrismaClientValidationError') {
    return { status: 400, message: 'Invalid request data' };
  }
  switch (err?.code) {
    case 'P2002': // unique constraint violation
      return { status: 409, message: 'A record with these details already exists' };
    case 'P2025': // required record not found (update/delete of a missing row)
      return { status: 404, message: 'Record not found' };
    case 'P2003': // foreign-key constraint failed
      return { status: 409, message: 'This action conflicts with related records' };
    case 'P2000': // value too long for the column
      return { status: 400, message: 'One or more values are too long' };
    case 'P2011': // null constraint violation
    case 'P2012': // missing required value
      return { status: 400, message: 'A required value is missing' };
    default:
      return null;
  }
}

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

  const mapped = mapPrismaError(err);
  if (mapped) {
    // Log the full Prisma error server-side for debugging, but never ship its details.
    logger.warn('[%s] Prisma error %s -> %d', requestId || '-', (err as any).code || (err as any).name, mapped.status);
    res.status(mapped.status).json({ error: mapped.message, requestId });
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
