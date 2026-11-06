import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { CredentialAction, CredentialScope } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import { credentialsKey, CredentialKeyMismatch, decryptWith, encryptWith, generatePassword } from '../utils/credentialCrypto.js';
import {
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  checkUnusualActivity,
  keyForWriting,
  keyStatus,
  logCredential,
  prepareImport,
  takeReveal,
  type ImportMapping,
} from '../services/credentials.js';

/**
 * Logins (Credentials plan): one safe place for the studio's own and its
 * clients' logins. Management only, every route — `requireManagement()`, the
 * preset, so a `setup.admin` who is not Management is refused like anybody.
 *
 * Passwords leave the server only through `/:id/reveal`, which logs who asked
 * (decision 5). Lists never carry a password or the notes, not even
 * encrypted. Every answer is `Cache-Control: no-store`.
 *
 * NEVER echo a request body into an error message or a log line: bodies here
 * hold passwords. Nothing in this file does, and nothing should.
 */

export const credentialsRouter = Router();
credentialsRouter.use(authenticate, requireManagement('Logins are Management’s alone.'));
credentialsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const LIST_SELECT = {
  id: true,
  scope: true,
  companyId: true,
  company: { select: { id: true, name: true } },
  name: true,
  website: true,
  username: true,
  notesEnc: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

type ListRow = { notesEnc: string | null; passwordEnc?: string } & Record<string, unknown>;

/**
 * A login as the list shows it — never the password, and the notes only as
 * "has some". The selects above never read `passwordEnc`; this drops it again
 * anyway, so a wider select somewhere later still cannot leak it.
 */
const view = ({ notesEnc, passwordEnc: _never, ...row }: ListRow) => ({ ...row, hasNotes: Boolean(notesEnc) });

const ip = (req: AuthRequest) => req.ip ?? null;

// ── Status and lists ─────────────────────────────────────────────────────────

/** GET /api/credentials/status — is the key there, and is it the right one? */
credentialsRouter.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, ...(await keyStatus(req.user!.organizationId)) });
  } catch (e) {
    next(e);
  }
});

const listQuery = z.object({
  scope: z.enum(['INTERNAL', 'CLIENT']).optional(),
  companyId: z.string().optional(),
  q: z.string().max(100).optional(),
});

/** GET /api/credentials — the list, without secrets, plus the companies for the pickers. */
credentialsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const q = listQuery.parse(req.query);
    const term = q.q?.trim();
    const rows = await prisma.credential.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(q.scope ? { scope: q.scope } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { website: { contains: term, mode: 'insensitive' } },
                { username: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }],
      select: LIST_SELECT,
    });
    const companies = await prisma.company.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    res.json({ success: true, credentials: (rows ?? []).map(view), companies: companies ?? [] });
  } catch (e) {
    next(e);
  }
});

/** GET /api/credentials/deleted — Recently deleted, for 30 days. */
credentialsRouter.get('/deleted', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.credential.findMany({
      where: { organizationId: req.user!.organizationId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { ...LIST_SELECT, deletedBy: { select: { id: true, name: true } } },
    });
    res.json({ success: true, credentials: (rows ?? []).map(view) });
  } catch (e) {
    next(e);
  }
});

const LOG_SELECT = {
  id: true,
  at: true,
  action: true,
  credentialId: true,
  credentialName: true,
  ip: true,
  detail: true,
  user: { select: { id: true, name: true } },
} as const;

/** GET /api/credentials/log?userId= — everything, latest first, filterable by person. */
credentialsRouter.get('/log', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined;
    const [entries, people] = await Promise.all([
      prisma.credentialLog.findMany({ where: { organizationId: orgId, ...(userId ? { userId } : {}) }, orderBy: { at: 'desc' }, take: 500, select: LOG_SELECT }),
      prisma.credentialLog.findMany({ where: { organizationId: orgId }, distinct: ['userId'], select: { user: { select: { id: true, name: true, active: true } } } }),
    ]);
    res.json({ success: true, entries: entries ?? [], people: (people ?? []).map((p) => p.user) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/credentials/:id/log — "Who opened this", latest first. */
credentialsRouter.get('/:id/log', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const row = await prisma.credential.findFirst({ where: { id: String(req.params.id), organizationId: orgId }, select: { id: true } });
    if (!row) {
      res.status(404).json({ success: false, error: 'Login not found' });
      return;
    }
    const entries = await prisma.credentialLog.findMany({ where: { credentialId: row.id }, orderBy: { at: 'desc' }, take: 200, select: LOG_SELECT });
    res.json({ success: true, entries: entries ?? [] });
  } catch (e) {
    next(e);
  }
});

// ── Reveal (decision 5) ──────────────────────────────────────────────────────

/** POST /api/credentials/:id/reveal { purpose: 'show' | 'copy' } — the password and notes, logged. */
credentialsRouter.post('/:id/reveal', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ purpose: z.enum(['show', 'copy']) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Say whether this is to show or to copy.' });
      return;
    }
    const orgId = req.user!.organizationId;
    const limit = takeReveal(req.user!.userId);
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: `That is a lot of passwords in ten minutes. Wait ${Math.ceil(limit.retryAfterSeconds / 60) || 1} minute${limit.retryAfterSeconds > 60 ? 's' : ''} and try again.`,
      });
      return;
    }
    const key = credentialsKey();
    if (!key) {
      res.status(503).json({ success: false, error: 'Logins are not set up on this server yet: CREDENTIALS_KEY is missing.' });
      return;
    }
    const row = await prisma.credential.findFirst({
      where: { id: String(req.params.id), organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, passwordEnc: true, notesEnc: true },
    });
    if (!row) {
      res.status(404).json({ success: false, error: 'Login not found' });
      return;
    }
    let password: string;
    let notes: string | null;
    try {
      password = decryptWith(key, row.passwordEnc, row.id);
      notes = row.notesEnc ? decryptWith(key, row.notesEnc, row.id) : null;
    } catch (e) {
      if (e instanceof CredentialKeyMismatch) {
        res.status(503).json({ success: false, error: e.message });
        return;
      }
      throw e;
    }
    await logCredential({
      organizationId: orgId,
      credentialId: row.id,
      credentialName: row.name,
      userId: req.user!.userId,
      action: parsed.data.purpose === 'copy' ? CredentialAction.COPY : CredentialAction.SHOW,
      ip: ip(req),
    });
    // Twenty-plus different logins in ten minutes: the others are told. Never slows the answer.
    void checkUnusualActivity(orgId, { userId: req.user!.userId, name: req.user!.name }).catch(() => undefined);
    res.json({ success: true, password, notes });
  } catch (e) {
    next(e);
  }
});

// ── Add, edit, delete, restore ───────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();

const fields = z.object({
  scope: z.enum(['INTERNAL', 'CLIENT']),
  companyId: z.string().nullable().optional(),
  name: text(120).min(1, 'Give the login a name, like "WordPress admin".'),
  website: optionalText(500),
  username: optionalText(200),
  notes: z.string().max(4000).nullable().optional(),
});

const createSchema = fields.extend({ password: z.string().min(1, 'A login needs its password.').max(1000) });
const editSchema = fields.partial().extend({ password: z.string().min(1).max(1000).optional() });

/** The company a CLIENT login belongs to, checked as this organisation's; INTERNAL carries none. */
async function ownerFor(orgId: string, scope: 'INTERNAL' | 'CLIENT', companyId: string | null | undefined): Promise<{ companyId: string | null } | { error: string }> {
  if (scope === 'INTERNAL') return { companyId: null };
  if (!companyId) return { error: 'Pick the client this login belongs to.' };
  const company = await prisma.company.findFirst({ where: { id: companyId, organizationId: orgId }, select: { id: true } });
  if (!company) return { error: 'That client is not here.' };
  return { companyId: company.id };
}

/** POST /api/credentials — a new login. */
credentialsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const d = parsed.data;
    const owner = await ownerFor(orgId, d.scope, d.companyId);
    if ('error' in owner) {
      res.status(400).json({ success: false, error: owner.error });
      return;
    }
    const keyed = await keyForWriting(orgId);
    if ('error' in keyed) {
      res.status(keyed.status).json({ success: false, error: keyed.error });
      return;
    }
    const id = randomUUID();
    const row = await prisma.credential.create({
      data: {
        id,
        organizationId: orgId,
        scope: d.scope,
        companyId: owner.companyId,
        name: d.name,
        website: d.website || null,
        username: d.username || null,
        passwordEnc: encryptWith(keyed.key, d.password, id),
        notesEnc: d.notes?.trim() ? encryptWith(keyed.key, d.notes.trim(), id) : null,
        createdById: req.user!.userId,
      },
      select: LIST_SELECT,
    });
    await logCredential({ organizationId: orgId, credentialId: row.id, credentialName: row.name, userId: req.user!.userId, action: CredentialAction.CREATE, ip: ip(req) });
    res.status(201).json({ success: true, credential: view(row) });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/credentials/:id — change it. The password only when one is sent. */
credentialsRouter.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const d = parsed.data;
    const existing = await prisma.credential.findFirst({ where: { id: String(req.params.id), organizationId: orgId, deletedAt: null } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Login not found' });
      return;
    }
    const scope = d.scope ?? existing.scope;
    const owner = await ownerFor(orgId, scope, d.companyId !== undefined ? d.companyId : existing.companyId);
    if ('error' in owner) {
      res.status(400).json({ success: false, error: owner.error });
      return;
    }
    const changesSecret = d.password !== undefined || d.notes !== undefined;
    let key: Buffer | null = null;
    if (changesSecret) {
      const keyed = await keyForWriting(orgId);
      if ('error' in keyed) {
        res.status(keyed.status).json({ success: false, error: keyed.error });
        return;
      }
      key = keyed.key;
    }
    const row = await prisma.credential.update({
      where: { id: existing.id },
      data: {
        scope,
        companyId: owner.companyId,
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.website !== undefined ? { website: d.website || null } : {}),
        ...(d.username !== undefined ? { username: d.username || null } : {}),
        ...(d.password !== undefined ? { passwordEnc: encryptWith(key!, d.password, existing.id), passwordChangedAt: new Date() } : {}),
        ...(d.notes !== undefined ? { notesEnc: d.notes?.trim() ? encryptWith(key!, d.notes.trim(), existing.id) : null } : {}),
        updatedById: req.user!.userId,
      },
      select: LIST_SELECT,
    });
    await logCredential({
      organizationId: orgId,
      credentialId: row.id,
      credentialName: String(row.name),
      userId: req.user!.userId,
      action: d.password !== undefined ? CredentialAction.PASSWORD_CHANGED : CredentialAction.UPDATE,
      ip: ip(req),
    });
    res.json({ success: true, credential: view(row) });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/credentials/:id — to Recently deleted, for 30 days. */
credentialsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.credential.findFirst({ where: { id: String(req.params.id), organizationId: orgId, deletedAt: null }, select: { id: true, name: true } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Login not found' });
      return;
    }
    await prisma.credential.update({ where: { id: existing.id }, data: { deletedAt: new Date(), deletedById: req.user!.userId } });
    await logCredential({ organizationId: orgId, credentialId: existing.id, credentialName: existing.name, userId: req.user!.userId, action: CredentialAction.DELETE, ip: ip(req) });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/** POST /api/credentials/:id/restore — back from Recently deleted. */
credentialsRouter.post('/:id/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const existing = await prisma.credential.findFirst({ where: { id: String(req.params.id), organizationId: orgId, deletedAt: { not: null } }, select: { id: true, name: true } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Nothing to restore' });
      return;
    }
    const row = await prisma.credential.update({ where: { id: existing.id }, data: { deletedAt: null, deletedById: null }, select: LIST_SELECT });
    await logCredential({ organizationId: orgId, credentialId: existing.id, credentialName: existing.name, userId: req.user!.userId, action: CredentialAction.RESTORE, ip: ip(req) });
    res.json({ success: true, credential: view(row) });
  } catch (e) {
    next(e);
  }
});

/** GET /api/credentials/generate — a fresh 20-character password for the form's Generate button. */
credentialsRouter.get('/generate', (_req, res) => {
  res.json({ success: true, password: generatePassword() });
});

// ── Import from a sheet (decision 8) ─────────────────────────────────────────

const importSchema = z.object({
  csv: z.string().min(1, 'No file content received').max(IMPORT_MAX_BYTES, 'The file is over 2 MB. Split it, or remove columns you do not need.'),
  mapping: z.record(z.enum(IMPORT_FIELDS), z.string().nullable()).optional(),
  /** Row number → 'INTERNAL' or a company id, for rows whose client could not be matched. */
  clientChoices: z.record(z.string(), z.string()).optional(),
  dryRun: z.boolean().default(true),
});

/**
 * POST /api/credentials/import — the sheet, parsed in memory only. A dry run
 * answers with every row and its fate, passwords masked; the real run saves
 * the OK rows and logs one line with the counts. The file is never written
 * anywhere.
 */
credentialsRouter.post('/import', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const orgId = req.user!.organizationId;
    const { csv, mapping, clientChoices, dryRun } = parsed.data;
    const prepared = await prepareImport(orgId, csv, mapping as ImportMapping | undefined, clientChoices as Record<string, string> | undefined);
    const counts = {
      total: prepared.rows.length,
      ok: prepared.rows.filter((r) => r.status === 'OK').length,
      skipped: prepared.rows.filter((r) => r.status === 'DUPLICATE').length,
      problems: prepared.rows.filter((r) => r.status !== 'OK' && r.status !== 'DUPLICATE').length,
      truncated: parsed.data.csv.length > 0 && prepared.rows.length >= IMPORT_MAX_ROWS,
    };
    if (dryRun) {
      res.json({ success: true, dryRun: true, headers: prepared.headers, mapping: prepared.mapping, rows: prepared.rows, counts });
      return;
    }
    const keyed = await keyForWriting(orgId);
    if ('error' in keyed) {
      res.status(keyed.status).json({ success: false, error: keyed.error });
      return;
    }
    let imported = 0;
    for (const row of prepared.rows) {
      if (row.status !== 'OK') continue;
      const secret = prepared.secrets.get(row.row)!;
      const id = randomUUID();
      await prisma.credential.create({
        data: {
          id,
          organizationId: orgId,
          scope: row.client === 'INTERNAL' ? CredentialScope.INTERNAL : CredentialScope.CLIENT,
          companyId: row.client === 'INTERNAL' ? null : row.client,
          name: row.name.slice(0, 120),
          website: row.website?.slice(0, 500) ?? null,
          username: row.username?.slice(0, 200) ?? null,
          passwordEnc: encryptWith(keyed.key, secret.password, id),
          notesEnc: secret.notes ? encryptWith(keyed.key, secret.notes.slice(0, 4000), id) : null,
          createdById: req.user!.userId,
        },
      });
      imported++;
    }
    await logCredential({
      organizationId: orgId,
      credentialId: null,
      credentialName: 'Import from sheet',
      userId: req.user!.userId,
      action: CredentialAction.IMPORT,
      ip: ip(req),
      detail: `Imported ${imported} login${imported === 1 ? '' : 's'}${counts.skipped ? ` (${counts.skipped} skipped)` : ''}`,
    });
    res.json({ success: true, dryRun: false, imported, counts, rows: prepared.rows });
  } catch (e) {
    next(e);
  }
});
