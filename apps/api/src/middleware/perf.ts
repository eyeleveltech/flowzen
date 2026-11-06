/**
 * Measuring, and shrinking, what the API sends (Perf Plan 1, decisions 1 and 4).
 *
 * Two middlewares, mounted ahead of every router in index.ts:
 *
 *   requestTiming  — a `Server-Timing: app;dur=…` header on every answer, so
 *                    DevTools shows how long the API itself took apart from
 *                    the network; and a `warn` line for any request over
 *                    SLOW_REQUEST_MS (500 by default): method, the ROUTE
 *                    PATTERN with ids stripped, the duration, the status and
 *                    the caller's preset. Never a user id, never a body — the
 *                    log says "GET /api/tasks/:id/status took 900 ms for a
 *                    HEAD", which is enough to find the slow screen and
 *                    nothing that identifies the person.
 *
 *   compressResponses — gzip (or brotli, when the browser asks) on JSON and
 *                    text answers over 1 KB. The live stream (`text/event-stream`)
 *                    is left alone: a compressed stream buffers until it is
 *                    closed, which would delay every event by half an hour.
 *                    Already-compressed types (images, zips) are skipped by
 *                    compression's own filter, and `Cache-Control: no-transform`
 *                    is honoured.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import compression from 'compression';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from './auth.js';

/** Over this many milliseconds, a request is logged. */
export const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 500;

/** An id in a path — a cuid, a uuid or a number — so one screen's requests group under one line. */
const ID_IN_PATH = /\b(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,})\b/gi;

/**
 * The route as it was declared — `/api/tasks/:id/status` — rather than the
 * address that was called. Express leaves `req.route` on the request once a
 * handler matched; a 404 has none, so its path has the ids blanked instead.
 */
export function routePattern(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route?.path;
  if (typeof route === 'string') return `${req.baseUrl}${route === '/' ? '' : route}`;
  return `${req.baseUrl}${req.path}`.replace(ID_IN_PATH, ':id');
}

export type SlowRequest = { method: string; route: string; ms: number; status: number; role: string };

export function requestTiming(
  opts: { slowMs?: number; onSlow?: (slow: SlowRequest) => void } = {},
): RequestHandler {
  const slowMs = opts.slowMs ?? SLOW_MS;
  const onSlow =
    opts.onSlow ??
    ((s: SlowRequest) => logger.warn(`Slow request: ${s.method} ${s.route} took ${s.ms} ms (${s.status}, ${s.role})`, s));

  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;

    /*
     * Server-Timing goes on at the last moment before the headers leave,
     * which is `writeHead` — after that nothing can be added. Anything
     * already there (another layer's figure) is kept beside it.
     */
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => Response;
    res.writeHead = ((...args: unknown[]) => {
      if (!res.headersSent) {
        const prior = res.getHeader('Server-Timing');
        const mine = `app;dur=${elapsed().toFixed(1)}`;
        res.setHeader('Server-Timing', prior ? `${String(prior)}, ${mine}` : mine);
      }
      return writeHead(...args);
    }) as Response['writeHead'];

    res.on('finish', () => {
      // The stream "finishes" when it is closed, half an hour later. Not slow.
      if (String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream')) return;
      const ms = Math.round(elapsed());
      if (ms < slowMs) return;
      onSlow({
        method: req.method,
        route: routePattern(req),
        ms,
        status: res.statusCode,
        role: (req as AuthRequest).user?.preset ?? 'anonymous',
      });
    });

    next();
  };
}

/** Everything compression would compress, except the live stream. */
export function compressible(req: Request, res: Response): boolean {
  if (String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
}

export function compressResponses(): RequestHandler {
  return compression({ filter: compressible, threshold: 1024 });
}
