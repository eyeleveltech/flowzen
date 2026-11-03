import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, sessionOf, type AuthRequest } from '../middleware/auth.js';
import { API_KEY_RULE } from '../services/alertRules.js';
import {
  API_SCOPES,
  ApiKeysUnavailable,
  EXPIRY_DAYS,
  MAX_ACTIVE_KEYS,
  SCOPE_KEYS,
  expiryFrom,
  generateKey,
  keyStatus,
  pepper,
  scopesFor,
  type ExpiryChoice,
} from '../services/apiKeys.js';
import { ENDPOINTS } from '../services/publicApi/endpoints.js';
import { TOOLS } from '../services/publicApi/mcpTools.js';
import { API_LOG_KEEP_DAYS } from '../workers/apiCleanup.cron.js';

/**
 * Settings → API (API Plan 1, decision 1): the "Allow API keys" switch, and
 * making, renaming, re-scoping and revoking keys. `setup.admin` only.
 *
 * A session route, under /api like every other screen's — an API key cannot
 * manage API keys. The key itself is in the answer to "create" and nowhere
 * else, ever: only its hash is stored.
 */

export const apiKeysRouter = Router();
apiKeysRouter.use(authenticate, requirePermission('setup.admin'));

const CREATOR = { select: { id: true, name: true, organizationId: true, email: true, preset: true, permissions: true, active: true } } as const;

type KeyRow = Prisma.ApiKeyGetPayload<{ include: { createdBy: typeof CREATOR; revokedBy: { select: { id: true; name: true } } } }>;

/** A key as the list shows it — never its hash, and never the key. */
function keyView(k: KeyRow, now = new Date()) {
  const creator = sessionOf(k.createdBy);
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    /** What the creator can tick on it today — the limit for "Edit scopes". */
    allowedScopes: scopesFor(creator),
    createdBy: { id: k.createdBy.id, name: k.createdBy.name, active: k.createdBy.active },
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    revokedBy: k.revokedBy,
    status: keyStatus(k, now),
  };
}

const include = { createdBy: CREATOR, revokedBy: { select: { id: true, name: true } } } as const;

/** Whether this server can make keys at all (API_KEY_PEPPER in production). */
const configured = () => {
  try {
    pepper();
    return true;
  } catch (e) {
    if (e instanceof ApiKeysUnavailable) return false;
    throw e;
  }
};

/** The bell every setup.admin gets: "API key 'n8n' created by Harish". */
async function ring(orgId: string, keyId: string, message: string) {
  await prisma.alert.create({
    data: { organizationId: orgId, rule: API_KEY_RULE, severity: 'LOW', entityType: 'ApiKey', entityId: keyId, message },
  });
}

const log = (req: AuthRequest, entityType: 'ApiKey' | 'Organization', entityId: string, verb: string, payload: Prisma.InputJsonValue) =>
  prisma.activity.create({
    data: { organizationId: req.user!.organizationId, entityType, entityId, actorId: req.user!.userId, verb, payload },
  });

/** GET /api/api-keys — the switch, every key, and the scopes this admin can give. */
apiKeysRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [org, keys] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { apiEnabled: true } }),
      prisma.apiKey.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, include }),
    ]);
    const now = new Date();
    const views = keys.map((k) => keyView(k, now));
    res.json({
      success: true,
      enabled: Boolean(org?.apiEnabled),
      configured: configured(),
      maxActive: MAX_ACTIVE_KEYS,
      activeCount: views.filter((k) => k.status === 'active').length,
      expiryChoices: Object.keys(EXPIRY_DAYS),
      scopes: API_SCOPES.map((s) => ({ key: s.key, group: s.group, label: s.label, description: s.description })),
      /** "This key acts as you, Harish." */
      me: { id: req.user!.userId, name: req.user!.name },
      myScopes: scopesFor(req.user!),
      keys: views,
      logKeepDays: API_LOG_KEEP_DAYS,
      // The docs on the tab, from the same lists the API is built from.
      endpoints: ENDPOINTS.map((e) => ({ method: e.method.toUpperCase(), path: `/v1${e.path}`, scopes: e.scopes, summary: e.summary })),
      tools: TOOLS.map((t) => ({ name: t.name, title: t.title, scopes: t.scopes, writes: !t.annotations.readOnlyHint })),
    });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/api-keys/settings — "Allow API keys". Off refuses every key at once. */
apiKeysRouter.patch('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Say whether API keys are on or off.' });
      return;
    }
    const orgId = req.user!.organizationId;
    await prisma.organization.update({ where: { id: orgId }, data: { apiEnabled: parsed.data.enabled } });
    await log(req, 'Organization', orgId, 'api_keys_switched', { enabled: parsed.data.enabled });
    res.json({ success: true, enabled: parsed.data.enabled });
  } catch (e) {
    next(e);
  }
});

const nameSchema = z.string().trim().min(1, 'Give the key a name, like "n8n automations".').max(60, 'Keep the name under 60 characters.');
const scopesSchema = z.array(z.enum(SCOPE_KEYS)).min(1, 'Tick at least one thing the key can do.');

const createSchema = z.object({
  name: nameSchema,
  scopes: scopesSchema,
  expiry: z.enum(Object.keys(EXPIRY_DAYS) as [ExpiryChoice, ...ExpiryChoice[]]),
});

/** The scopes asked for that this person does not hold the permission for. */
const beyond = (asked: string[], allowed: string[]) => asked.filter((s) => !allowed.includes(s));

/**
 * POST /api/api-keys — make a key. The answer carries the key itself, once.
 * It acts as whoever makes it, so it can only carry what they hold.
 */
apiKeysRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    if (!configured()) {
      res.status(503).json({
        success: false,
        error: 'This server is not set up for API keys yet: API_KEY_PEPPER is missing from its environment.',
      });
      return;
    }
    const orgId = req.user!.organizationId;
    const { name, expiry } = parsed.data;
    const scopes = [...new Set(parsed.data.scopes)];
    const over = beyond(scopes, scopesFor(req.user!));
    if (over.length) {
      res.status(403).json({ success: false, error: `You cannot give a key what you cannot do yourself: ${over.join(', ')}.` });
      return;
    }
    const now = new Date();
    const active = await prisma.apiKey.count({
      where: { organizationId: orgId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (active >= MAX_ACTIVE_KEYS) {
      res.status(409).json({ success: false, error: `There are already ${MAX_ACTIVE_KEYS} working keys. Revoke one you no longer use first.` });
      return;
    }

    const { key, keyHash, prefix } = generateKey();
    const row = await prisma.apiKey.create({
      data: {
        organizationId: orgId,
        name,
        prefix,
        keyHash,
        scopes,
        createdById: req.user!.userId,
        expiresAt: expiryFrom(expiry, now),
      },
      include,
    });
    await log(req, 'ApiKey', row.id, 'api_key_created', { name, scopes, expiry });
    await ring(orgId, row.id, `API key '${name}' created by ${req.user!.name}`);

    res.status(201).json({ success: true, key, apiKey: keyView(row, now) });
  } catch (e) {
    next(e);
  }
});

const editSchema = z
  .object({ name: nameSchema.optional(), scopes: scopesSchema.optional() })
  .refine((v) => v.name !== undefined || v.scopes !== undefined, { message: 'Nothing to change.' });

/** PATCH /api/api-keys/:id — rename, or change what it can do (within its creator's permissions). */
apiKeysRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const existing = await prisma.apiKey.findFirst({ where: { id: String(req.params.id), organizationId: orgId }, include });
    if (!existing) {
      res.status(404).json({ success: false, error: 'API key not found' });
      return;
    }
    if (keyStatus(existing) !== 'active') {
      res.status(409).json({ success: false, error: 'This key no longer works, so there is nothing to change. Make a new one.' });
      return;
    }
    const { name } = parsed.data;
    const scopes = parsed.data.scopes ? [...new Set(parsed.data.scopes)] : undefined;
    if (scopes) {
      // The key acts as its creator, whoever is editing it.
      const over = beyond(scopes, scopesFor(sessionOf(existing.createdBy)));
      if (over.length) {
        res.status(403).json({
          success: false,
          error: `${existing.createdBy.name} cannot do these, so their key cannot either: ${over.join(', ')}.`,
        });
        return;
      }
    }
    const row = await prisma.apiKey.update({
      where: { id: existing.id },
      data: { ...(name !== undefined ? { name } : {}), ...(scopes ? { scopes } : {}) },
      include,
    });
    if (name !== undefined && name !== existing.name) {
      await log(req, 'ApiKey', row.id, 'api_key_renamed', { from: existing.name, to: name });
    }
    if (scopes && (scopes.length !== existing.scopes.length || scopes.some((s) => !existing.scopes.includes(s)))) {
      await log(req, 'ApiKey', row.id, 'api_key_scopes_changed', { name: row.name, scopes });
    }
    res.json({ success: true, apiKey: keyView(row) });
  } catch (e) {
    next(e);
  }
});

/** POST /api/api-keys/:id/revoke — stops working on the next request. Kept, so its history stays readable. */
apiKeysRouter.post('/:id/revoke', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.apiKey.findFirst({ where: { id: String(req.params.id), organizationId: orgId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'API key not found' });
      return;
    }
    if (existing.revokedAt) {
      res.status(409).json({ success: false, error: 'This key is already revoked.' });
      return;
    }
    const row = await prisma.apiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: req.user!.userId },
      include,
    });
    await log(req, 'ApiKey', row.id, 'api_key_revoked', { name: row.name });
    await ring(orgId, row.id, `API key '${row.name}' revoked by ${req.user!.name}`);
    res.json({ success: true, apiKey: keyView(row) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/api-keys/:id/usage — its last 100 calls: when, what, and how it went. Never a body. */
apiKeysRouter.get('/:id/usage', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const key = await prisma.apiKey.findFirst({ where: { id: String(req.params.id), organizationId: orgId }, select: { id: true } });
    if (!key) {
      res.status(404).json({ success: false, error: 'API key not found' });
      return;
    }
    const calls = await prisma.apiRequestLog.findMany({
      where: { apiKeyId: key.id },
      orderBy: { at: 'desc' },
      take: 100,
      select: { id: true, at: true, method: true, route: true, status: true, durationMs: true },
    });
    res.json({ success: true, calls });
  } catch (e) {
    next(e);
  }
});
