import express, { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, hasPermission, type AuthRequest } from '../middleware/auth.js';
import { API_SCOPES, SCOPE_KEYS } from '../services/apiKeys.js';
import {
  OAuthError,
  authorizationServerMetadata,
  authorizeParamsSchema,
  checkAuthorize,
  consent,
  deniedRedirect,
  exchangeCode,
  mcpUrl,
  protectedResourceMetadata,
  refreshTokens,
  registerClient,
  revokeToken,
  tokenRequestSchema,
} from '../services/oauth.js';
import { logger } from '../utils/logger.js';

/**
 * "Sign in with Flowzen" (API Plan 2) — the HTTP side of services/oauth.ts.
 *
 * Two routers. `wellKnownRouter` is discovery, open to anyone: where the
 * sign-in is and what it offers. `oauthRouter` is the protocol — register a
 * client, exchange a code, refresh, revoke — plus the consent screen's two
 * calls, which run on a signed-in session like any screen, and the
 * connected-apps list in Settings → API.
 *
 * Nothing here gives out data. The token an app ends up with only opens
 * /api/mcp, where it is checked like a key on every call.
 */

export const wellKnownRouter = Router();

const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

/** Public metadata: anybody may read it, and nothing in it is secret. Cached a little, since the apps re-read it. */
const metadata = (res: Response, body: unknown) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(body);
};

wellKnownRouter.get('/oauth-authorization-server', (_req, res) => metadata(res, authorizationServerMetadata()));
// Both forms: the plain one, and the path-aware one for `/api/mcp` (RFC 9728 §3.1).
wellKnownRouter.get(['/oauth-protected-resource', '/oauth-protected-resource/*'], (_req, res) =>
  metadata(res, protectedResourceMetadata()),
);

// ── The protocol ─────────────────────────────────────────────────────────────

export const oauthRouter = Router();

/** `{ error, error_description }` — the shape OAuth clients read (RFC 6749 §5.2). */
const sendOAuthError = (res: Response, e: OAuthError) => {
  noStore(res);
  res.status(e.status).json({ error: e.error, error_description: e.description });
};

const oauthErrors = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof OAuthError) {
    sendOAuthError(res, err);
    return;
  }
  next(err);
};

/**
 * Registration is open — that is what Dynamic Client Registration means — so
 * it is the one place a stranger can write a row. Tightly limited, and the
 * rows a client never signs in through are swept after a month.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', error_description: 'Too many registrations from this address. Try again in an hour.' },
});

/** POST /api/oauth/register — RFC 7591, public clients only. */
oauthRouter.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const client = await registerClient(req.body);
    noStore(res);
    res.status(201).json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  } catch (e) {
    next(e);
  }
});

/** The apps send the token request as a form (RFC 6749 §4.1.3); JSON is read too, for anything else. */
const formOrJson = [express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' })];

/** POST /api/oauth/token — a code for tokens, or a refresh token for new ones. */
oauthRouter.post('/token', ...formOrJson, async (req, res, next) => {
  try {
    const parsed = tokenRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new OAuthError('invalid_request', parsed.error.issues[0]?.message ?? 'The request is not valid.');
    const body = parsed.data;
    let tokens;
    if (body.grant_type === 'authorization_code') tokens = await exchangeCode(body);
    else if (body.grant_type === 'refresh_token') tokens = await refreshTokens(body);
    else throw new OAuthError('unsupported_grant_type', 'Use grant_type=authorization_code or refresh_token.');
    noStore(res);
    res.setHeader('Pragma', 'no-cache');
    res.json(tokens);
  } catch (e) {
    next(e);
  }
});

/** POST /api/oauth/revoke — RFC 7009. Always 200: the token is gone either way. */
oauthRouter.post('/revoke', ...formOrJson, async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
    await revokeToken(token);
    noStore(res);
    res.status(200).json({});
  } catch (e) {
    next(e);
  }
});

// ── The consent screen (a signed-in session) ─────────────────────────────────

const log = (req: AuthRequest, verb: string, userId: string, payload: Prisma.InputJsonValue) =>
  prisma.activity.create({
    data: { organizationId: req.user!.organizationId, entityType: 'User', entityId: userId, actorId: req.user!.userId, verb, payload },
  });

/** The sign-in's parameters, as the browser carried them to /oauth/authorize. */
const readParams = (raw: unknown) => {
  const parsed = authorizeParamsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * GET /api/oauth/authorize — what the consent screen shows: who is asking,
 * where they will be sent back to, and what they may be given. The checks are
 * the ones the standard requires before anything is sent anywhere.
 */
oauthRouter.get('/authorize', authenticate, async (req: AuthRequest, res, next) => {
  try {
    noStore(res);
    const params = readParams(req.query);
    if (!params) {
      res.status(400).json({ success: false, error: 'This sign-in link is incomplete. Start again from the app.', data: { fatal: true, redirectTo: null } });
      return;
    }
    const check = await checkAuthorize(params, req.user!);
    if (!check.ok) {
      res.status(400).json({ success: false, error: check.message, data: { fatal: check.fatal, redirectTo: check.fatal ? null : check.redirectTo } });
      return;
    }
    const labels = API_SCOPES.filter((s) => check.offered.includes(s.key)).map((s) => ({
      key: s.key,
      group: s.group,
      label: s.label,
      description: s.description,
    }));
    res.json({
      success: true,
      app: { name: check.client.name, host: hostOf(check.client.clientUri ?? check.client.clientId), returnsTo: hostOf(check.redirectUri) },
      me: { id: req.user!.userId, name: req.user!.name, email: req.user!.email },
      resource: mcpUrl(),
      scopes: labels,
      /** Asked for, but not something this person can do — shown greyed, so nobody wonders where it went. */
      notYours: check.requested.filter((s) => !check.offered.includes(s)),
    });
  } catch (e) {
    next(e);
  }
});

const decisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  scopes: z.array(z.enum(SCOPE_KEYS)).default([]),
  params: authorizeParamsSchema,
});

/** POST /api/oauth/authorize — the person's answer. Both answers end at the app's address. */
oauthRouter.post('/authorize', authenticate, async (req: AuthRequest, res, next) => {
  try {
    noStore(res);
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'The answer is not valid.' });
      return;
    }
    const { decision, scopes, params } = parsed.data;
    const check = await checkAuthorize(params, req.user!);
    if (!check.ok) {
      res.status(400).json({ success: false, error: check.message, data: { fatal: check.fatal, redirectTo: check.fatal ? null : check.redirectTo } });
      return;
    }
    if (decision === 'deny') {
      res.json({ success: true, redirectTo: deniedRedirect(check.redirectUri, params.state) });
      return;
    }
    const out = await consent(req.user!, check, scopes, params);
    await log(req, 'connector_connected', req.user!.userId, { app: check.client.name, scopes: out.scopes, grantId: out.grantId });
    res.json({ success: true, redirectTo: out.redirectTo });
  } catch (e) {
    if (e instanceof OAuthError) {
      res.status(400).json({ success: false, error: e.description });
      return;
    }
    next(e);
  }
});

// ── Connected apps (Settings → API) ──────────────────────────────────────────

const GRANT_INCLUDE = {
  client: { select: { id: true, name: true, clientId: true, clientUri: true, kind: true } },
  user: { select: { id: true, name: true, active: true } },
  revokedBy: { select: { id: true, name: true } },
} as const;

type GrantRow = Prisma.OAuthGrantGetPayload<{ include: typeof GRANT_INCLUDE }>;

/** A connection as the list shows it. */
const grantView = (g: GrantRow) => ({
  id: g.id,
  app: { name: g.client.name, host: hostOf(g.client.clientUri ?? g.client.clientId), kind: g.client.kind },
  person: g.user,
  scopes: g.scopes,
  createdAt: g.createdAt,
  lastUsedAt: g.lastUsedAt,
  lastUsedIp: g.lastUsedIp,
  revokedAt: g.revokedAt,
  revokedBy: g.revokedBy,
  status: g.revokedAt ? ('revoked' as const) : ('active' as const),
});

/** Whether this person sees everybody's connections, or only their own. */
const seesAll = (req: AuthRequest) => hasPermission(req.user!, 'setup.admin');

/** GET /api/oauth/grants — mine, or everyone's for an admin. */
oauthRouter.get('/grants', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const where = seesAll(req) ? { organizationId: orgId } : { organizationId: orgId, userId: req.user!.userId };
    const rows = await prisma.oAuthGrant.findMany({ where, orderBy: { createdAt: 'desc' }, include: GRANT_INCLUDE });
    res.json({
      success: true,
      all: seesAll(req),
      me: req.user!.userId,
      mcpUrl: mcpUrl(),
      scopes: API_SCOPES.map((s) => ({ key: s.key, group: s.group, label: s.label, description: s.description })),
      grants: rows.map(grantView),
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/oauth/grants/:id/revoke — every token under it is refused from the next request. */
oauthRouter.post('/grants/:id/revoke', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.oAuthGrant.findFirst({ where: { id: String(req.params.id), organizationId: orgId }, include: GRANT_INCLUDE });
    if (!existing || (!seesAll(req) && existing.userId !== req.user!.userId)) {
      res.status(404).json({ success: false, error: 'Connection not found' });
      return;
    }
    if (existing.revokedAt) {
      res.status(409).json({ success: false, error: 'This connection is already revoked.' });
      return;
    }
    const row = await prisma.oAuthGrant.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: req.user!.userId },
      include: GRANT_INCLUDE,
    });
    await log(req, 'connector_revoked', existing.userId, { app: existing.client.name, grantId: existing.id });
    res.json({ success: true, grant: grantView(row) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/oauth/grants/:id/usage — its last 100 calls, like a key's. */
oauthRouter.get('/grants/:id/usage', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const grant = await prisma.oAuthGrant.findFirst({ where: { id: String(req.params.id), organizationId: orgId }, select: { id: true, userId: true } });
    if (!grant || (!seesAll(req) && grant.userId !== req.user!.userId)) {
      res.status(404).json({ success: false, error: 'Connection not found' });
      return;
    }
    const calls = await prisma.apiRequestLog.findMany({
      where: { grantId: grant.id },
      orderBy: { at: 'desc' },
      take: 100,
      select: { id: true, at: true, method: true, route: true, status: true, durationMs: true },
    });
    res.json({ success: true, calls });
  } catch (e) {
    next(e);
  }
});

oauthRouter.use(oauthErrors);
oauthRouter.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  // A broken body on the protocol routes answers in the protocol's shape.
  const e = err as { type?: string };
  if (e?.type === 'entity.parse.failed') {
    sendOAuthError(res, new OAuthError('invalid_request', 'The body could not be read.'));
    return;
  }
  logger.error(`OAuth: ${err.stack ?? err.message}`);
  next(err);
});
