import { createHash } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { sessionOf, type AuthRequest } from './auth.js';
import { apiCall } from '../services/apiCallContext.js';
import {
  ApiKeysUnavailable,
  KEY_PATTERN,
  KEY_PREFIX,
  effectiveScopes,
  hashKey,
  sameHash,
  type ApiScope,
} from '../services/apiKeys.js';
import { logger } from '../utils/logger.js';

/**
 * The door to /api/v1 and /api/mcp (API Plan 1, decisions 2 and 6).
 *
 * Only an API key opens it — a signed-in session does not — and only as
 * `Authorization: Bearer fz_live_…` over HTTPS. A key works while it is not
 * revoked, not expired, its creator is still active and the organisation's
 * "Allow API keys" switch is on; each failure is a 401 with its own code, so
 * whoever set the automation up can tell which one it is.
 *
 * Once through, the request runs as the key's creator, exactly as if they had
 * made it in the app, and `req.apiKey.scopes` says which of their powers the
 * key carries.
 */

export interface ApiRequest extends AuthRequest {
  apiKey?: { id: string; name: string; prefix: string; scopes: ApiScope[] };
  /** The route pattern served, for the request log: "/v1/tasks/:id". Never the path itself. */
  apiRoute?: string;
}

/** `{ error: { code, message, details? } }` — every refusal on the public API. */
export function sendApiError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

/** Query parameters a key could be pasted into. Any of them present is refused. */
const KEY_PARAMS = ['key', 'api_key', 'apikey', 'access_token', 'token', 'auth'];

const keyInUrl = (query: unknown): boolean => {
  if (!query || typeof query !== 'object') return false;
  return Object.entries(query as Record<string, unknown>).some(
    ([name, value]) =>
      KEY_PARAMS.includes(name.toLowerCase()) || (typeof value === 'string' && value.startsWith(KEY_PREFIX)),
  );
};

/** How often `lastUsedAt` is written: once a minute is plenty for "last used", and spares a write per call. */
const LAST_USED_EVERY_MS = 60_000;

/** Run without waiting, and never let a bookkeeping write fail the request it is about. */
const quietly = (what: string, write: () => unknown) => {
  void Promise.resolve()
    .then(write)
    .catch((e) => logger.error(`API ${what}: ${e instanceof Error ? e.message : e}`));
};

export async function apiKeyAuth(req: ApiRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (keyInUrl(req.query)) {
      sendApiError(
        res,
        401,
        'key_in_url',
        'API keys are never accepted in the address. Send it as the header "Authorization: Bearer <key>" — and treat a key that has been put in a URL as exposed: revoke it and make a new one.',
      );
      return;
    }

    // Behind Apache, `secure` comes from X-Forwarded-Proto (trust proxy 1).
    if (process.env.NODE_ENV === 'production' && !req.secure) {
      sendApiError(
        res,
        403,
        'https_required',
        'The API only answers over HTTPS. If it already is HTTPS, the proxy in front must send "X-Forwarded-Proto: https".',
      );
      return;
    }

    const header = req.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
    if (!token) {
      sendApiError(res, 401, 'missing_key', 'Send an API key as the header "Authorization: Bearer fz_live_…". Make one in Settings → API.');
      return;
    }
    if (!token.startsWith(KEY_PREFIX) || !KEY_PATTERN.test(token)) {
      sendApiError(
        res,
        401,
        'invalid_key',
        'That is not a Flowzen API key. Keys start with "fz_live_"; a signed-in session does not work here.',
      );
      return;
    }

    const keyHash = hashKey(token);
    const key = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        organization: { select: { apiEnabled: true } },
        createdBy: {
          select: { id: true, organizationId: true, email: true, name: true, preset: true, permissions: true, active: true },
        },
      },
    });
    if (!key || !sameHash(key.keyHash, keyHash)) {
      sendApiError(res, 401, 'invalid_key', 'That API key is not recognised.');
      return;
    }
    if (!key.organization.apiEnabled) {
      sendApiError(res, 401, 'api_disabled', 'API keys are switched off for this organisation. An admin can turn them on in Settings → API.');
      return;
    }
    if (key.revokedAt) {
      sendApiError(res, 401, 'key_revoked', 'This API key has been revoked.');
      return;
    }
    const now = new Date();
    if (key.expiresAt && key.expiresAt <= now) {
      sendApiError(res, 401, 'key_expired', 'This API key has expired. Make a new one in Settings → API.');
      return;
    }
    if (!key.createdBy.active) {
      sendApiError(
        res,
        401,
        'creator_inactive',
        'The person who made this API key no longer has access to Flowzen, so the key has stopped working.',
      );
      return;
    }

    req.user = sessionOf(key.createdBy);
    req.apiKey = { id: key.id, name: key.name, prefix: key.prefix, scopes: effectiveScopes(key.scopes, req.user) };

    const ip = req.ip ?? null;
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS || key.lastUsedIp !== ip) {
      quietly('last used', () => prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now, lastUsedIp: ip } }));
    }

    // Everything after this, the writes included, knows which key it is under.
    apiCall.run({ keyId: key.id, keyName: key.name }, () => next());
  } catch (e) {
    if (e instanceof ApiKeysUnavailable) {
      logger.error(e.message);
      sendApiError(res, 503, 'api_not_configured', 'API keys are not set up on this server yet.');
      return;
    }
    next(e);
  }
}

/** A scope the key must carry. */
export function requireScope(...anyOf: ApiScope[]) {
  return (req: ApiRequest, res: Response, next: NextFunction): void => {
    if (anyOf.some((s) => req.apiKey?.scopes.includes(s))) {
      next();
      return;
    }
    sendApiError(
      res,
      403,
      'insufficient_scope',
      `This API key needs the ${anyOf.map((s) => `'${s}'`).join(' or ')} scope for this. An admin can add it in Settings → API.`,
      { required: anyOf },
    );
  };
}

// ── Rate limit ───────────────────────────────────────────────────────────────

/** Per key (decision 6): 120 a minute, and no more than 20 in any one second. */
export const RATE_LIMIT = { perMinute: 120, perSecond: 20 } as const;

type Bucket = { minuteStart: number; minute: number; secondStart: number; second: number; lastRefusalLogged: number };
const buckets = new Map<string, Bucket>();

/** For the tests: every key starts with a clean slate. */
export const resetRateLimits = () => buckets.clear();

/**
 * Whether this key may make one more call now. A refused call does not count
 * against the key, and says how long to wait.
 *
 * In memory, because production is one API process. A second process would
 * give each its own count — still a limit, just a looser one.
 */
export function takeRateToken(
  keyId: string,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfter: number; logIt: boolean } {
  let b = buckets.get(keyId);
  if (!b) {
    b = { minuteStart: now, minute: 0, secondStart: now, second: 0, lastRefusalLogged: 0 };
    buckets.set(keyId, b);
    if (buckets.size > 10_000) {
      for (const [id, old] of buckets) if (now - old.minuteStart > 120_000) buckets.delete(id);
    }
  }
  if (now - b.minuteStart >= 60_000) {
    b.minuteStart = now;
    b.minute = 0;
  }
  if (now - b.secondStart >= 1_000) {
    b.secondStart = now;
    b.second = 0;
  }
  const refuse = (resetAt: number) => {
    // A runaway loop refused 100 times a second would otherwise write 100 log
    // rows a second. One refusal a second is logged; the rest are not.
    const logIt = now - b!.lastRefusalLogged >= 1_000;
    if (logIt) b!.lastRefusalLogged = now;
    return { ok: false as const, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)), logIt };
  };
  if (b.minute >= RATE_LIMIT.perMinute) return refuse(b.minuteStart + 60_000);
  if (b.second >= RATE_LIMIT.perSecond) return refuse(b.secondStart + 1_000);
  b.minute += 1;
  b.second += 1;
  return { ok: true };
}

const SKIP_LOG = Symbol('flowzen.apiSkipLog');

export function apiRateLimit(req: ApiRequest, res: Response, next: NextFunction): void {
  const verdict = takeRateToken(req.apiKey!.id);
  if (verdict.ok) {
    next();
    return;
  }
  if (!verdict.logIt) (res as Response & { [SKIP_LOG]?: boolean })[SKIP_LOG] = true;
  res.setHeader('Retry-After', String(verdict.retryAfter));
  sendApiError(
    res,
    429,
    'rate_limited',
    `Too many requests for this key: at most ${RATE_LIMIT.perMinute} a minute and ${RATE_LIMIT.perSecond} a second. Try again in ${verdict.retryAfter}s.`,
    { retryAfter: verdict.retryAfter },
  );
}

// ── Request log ──────────────────────────────────────────────────────────────

/**
 * One row per call: time, method, route pattern, status and duration. Never a
 * body, never the query string, never an id from the path — the pattern is
 * what the route was registered as, so `/v1/tasks/:id` and not the task.
 */
export function apiRequestLog(req: ApiRequest, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    if ((res as Response & { [SKIP_LOG]?: boolean })[SKIP_LOG] || !req.apiKey) return;
    const apiKeyId = req.apiKey.id;
    quietly('request log', () =>
      prisma.apiRequestLog.create({
        data: {
          apiKeyId,
          method: req.method,
          route: (req.apiRoute ?? '(no such route)').slice(0, 200),
          status: res.statusCode,
          durationMs: Math.min(Date.now() - started, 2_147_483_647),
        },
      }),
    );
  });
  next();
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/** How long an Idempotency-Key is remembered (decision 6). */
export const IDEMPOTENCY_HOURS = 24;

/** What a stored answer may be: never a 5xx, which the retry should get past. */
const keepAnswer = (status: number) => status < 500 && status !== 409 && status !== 429;

/**
 * Wraps a POST so a retry with the same `Idempotency-Key` header gets the
 * first answer back instead of doing the work twice.
 *
 * The key is claimed with a placeholder row before the work starts, so two
 * copies of the same request arriving together cannot both get through: the
 * second finds the claim and is told to retry. The same key with a different
 * body is refused — answering it with the first request's result would be
 * answering a question that was not asked.
 */
export async function withIdempotency(
  req: ApiRequest,
  res: Response,
  run: () => Promise<void>,
): Promise<void> {
  const raw = req.header('Idempotency-Key');
  if (raw === undefined) {
    await run();
    return;
  }
  const idempotencyKey = raw.trim();
  if (!idempotencyKey || idempotencyKey.length > 255 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
    sendApiError(res, 400, 'invalid_idempotency_key', 'An Idempotency-Key is 1 to 255 visible characters, like a UUID.');
    return;
  }

  const apiKeyId = req.apiKey!.id;
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ method: req.method, path: req.originalUrl.split('?')[0], body: req.body ?? null }))
    .digest('hex');
  const where = { apiKeyId_idempotencyKey: { apiKeyId, idempotencyKey } };

  const existing = await prisma.apiIdempotency.findUnique({ where });
  if (existing && existing.createdAt.getTime() < Date.now() - IDEMPOTENCY_HOURS * 3_600_000) {
    await prisma.apiIdempotency.delete({ where }).catch(() => undefined);
  } else if (existing) {
    if (existing.requestHash !== requestHash) {
      sendApiError(res, 422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request. Use a new key for a new request.');
      return;
    }
    if (existing.status === 0) {
      res.setHeader('Retry-After', '1');
      sendApiError(res, 409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Try again in a moment.');
      return;
    }
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(existing.status).json(existing.body);
    return;
  }

  try {
    await prisma.apiIdempotency.create({ data: { apiKeyId, idempotencyKey, requestHash, status: 0, body: {} } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      res.setHeader('Retry-After', '1');
      sendApiError(res, 409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Try again in a moment.');
      return;
    }
    throw e;
  }

  // Keep what is answered, whatever answers it.
  const json = res.json.bind(res);
  let settled = false;
  res.json = (body: unknown) => {
    if (!settled) {
      settled = true;
      const status = res.statusCode;
      quietly('idempotency', () =>
        keepAnswer(status)
          ? prisma.apiIdempotency.update({ where, data: { status, body: (body ?? null) as Prisma.InputJsonValue } })
          : prisma.apiIdempotency.delete({ where }),
      );
    }
    return json(body);
  };
  try {
    await run();
  } catch (e) {
    if (!settled) {
      settled = true;
      quietly('idempotency', () => prisma.apiIdempotency.delete({ where }));
    }
    throw e;
  }
}
