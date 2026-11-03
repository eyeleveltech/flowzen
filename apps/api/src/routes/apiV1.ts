import express, { Router, type NextFunction, type Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import {
  apiKeyAuth,
  apiRateLimit,
  apiRequestLog,
  requireScope,
  sendApiError,
  withIdempotency,
  type ApiRequest,
} from '../middleware/apiKey.js';
import { ApiError, type ApiContext } from '../services/publicApi/core.js';
import { ENDPOINTS, endpointFor, type Endpoint } from '../services/publicApi/endpoints.js';
import { openApiDocument } from '../services/publicApi/openapi.js';
import { logger } from '../utils/logger.js';

/**
 * /api/v1 — the public REST API (API Plan 1, decision 4).
 *
 * For automation tools (n8n, Make, Zapier) holding an API key. Stable and
 * documented: its shapes are its own (services/publicApi/schemas.ts), not
 * what the app's screens happen to be sent, so a change inside the app does
 * not break somebody's automation.
 *
 * Mounted before the app's CORS and body parser (index.ts): it is server to
 * server, never for a browser, so there is no CORS here at all, and it parses
 * its own JSON so a bad body answers in its own error shape.
 */

export const apiV1Router = Router();

apiV1Router.use(express.json({ limit: '1mb' }));

/** The contract, open to anybody — what a tool imports to learn the API. Holds no data. */
apiV1Router.get('/openapi.json', (req, res) => {
  res.json(openApiDocument(`${req.protocol}://${req.get('host')}${req.baseUrl}`));
});

// Which route this is, before anything can refuse it, so even a 429 is logged by its pattern.
apiV1Router.use((req: ApiRequest, _res, next) => {
  const ep = endpointFor(req.method, req.path);
  req.apiRoute = ep ? `/v1${ep.path}` : undefined;
  next();
});
apiV1Router.use(apiKeyAuth, apiRequestLog, apiRateLimit);

export const contextOf = (req: ApiRequest): ApiContext => ({ user: req.user!, key: req.apiKey!, req });

/** A query or body read through its schema, or the first thing wrong with it as a 400. */
function parse(schema: ZodTypeAny, value: unknown, where: 'query' | 'body') {
  const out = schema.safeParse(value);
  if (out.success) return out.data;
  const issue = out.error.issues[0];
  const field = issue.path.join('.');
  throw new ApiError(400, 'invalid_request', field ? `${where} ${field}: ${issue.message}` : issue.message, {
    issues: out.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

const handler = (ep: Endpoint) => async (req: ApiRequest, res: Response, next: NextFunction) => {
  try {
    const query = ep.query ? parse(ep.query, req.query, 'query') : {};
    const body = ep.body ? parse(ep.body, req.body ?? {}, 'body') : undefined;
    const go = async () => {
      const out = await ep.run(contextOf(req), { params: req.params as Record<string, string>, query, body });
      res.status(out.status).json(out.body);
    };
    // A retried POST gets its first answer back (decision 6).
    if (ep.method === 'post') await withIdempotency(req, res, go);
    else await go();
  } catch (e) {
    next(e);
  }
};

for (const ep of ENDPOINTS) {
  const gate = ep.scopes.length ? [requireScope(...ep.scopes)] : [];
  apiV1Router[ep.method](ep.path, ...gate, handler(ep));
}

apiV1Router.use((_req, res) => {
  sendApiError(res, 404, 'not_found', 'There is no such endpoint. The list is at /api/v1/openapi.json.');
});

/** Every failure in one shape: `{ error: { code, message, details? } }`. */
export function apiErrorHandler(err: unknown, _req: ApiRequest, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    sendApiError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    sendApiError(res, 400, 'invalid_request', err.issues[0]?.message ?? 'The request is not valid.');
    return;
  }
  const e = err as { type?: string; status?: number; stack?: string; message?: string };
  if (e?.type === 'entity.parse.failed') {
    sendApiError(res, 400, 'invalid_json', 'The body is not valid JSON.');
    return;
  }
  if (e?.type === 'entity.too.large') {
    sendApiError(res, 413, 'body_too_large', 'The body is larger than 1 MB.');
    return;
  }
  logger.error(`Public API error: ${e?.stack ?? e?.message ?? err}`);
  sendApiError(res, 500, 'internal_error', 'Something went wrong on our side. Try again; if it keeps failing, tell the Flowzen admin.');
}

apiV1Router.use(apiErrorHandler);
