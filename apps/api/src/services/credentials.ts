import { CredentialAction, CredentialScope, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { credentialsKey, keyMatchesCheck, makeKeyCheck } from '../utils/credentialCrypto.js';
import { parseCsv } from '../utils/csv.js';

/**
 * Logins (Credentials plan): what is not the HTTP layer — the key check, the
 * reveal limits, the two Management bells, the import mapping, and the purge.
 *
 * Nothing in here writes to the shared Activity feed. Logins have their own
 * log (`CredentialLog`), so a login's name appears nowhere other people read,
 * and the log never carries a password.
 */

// ── The key ──────────────────────────────────────────────────────────────────

export type KeyStatus = {
  /** CREDENTIALS_KEY is set and well-formed. */
  keyConfigured: boolean;
  /** The key is the one the saved logins were made with; null before the first save. */
  keyMatches: boolean | null;
};

export async function keyStatus(organizationId: string): Promise<KeyStatus> {
  const key = credentialsKey();
  if (!key) return { keyConfigured: false, keyMatches: null };
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { credentialsKeyCheck: true } });
  if (!org?.credentialsKeyCheck) return { keyConfigured: true, keyMatches: null };
  return { keyConfigured: true, keyMatches: keyMatchesCheck(key, org.credentialsKeyCheck) };
}

/**
 * The key, ready to save with — or why not. On the first save the key check
 * is stored, so a different key later is told apart from a bad row.
 */
export async function keyForWriting(organizationId: string): Promise<{ key: Buffer } | { error: string; status: number }> {
  const key = credentialsKey();
  if (!key) return { status: 503, error: 'Logins are not set up on this server yet: CREDENTIALS_KEY is missing from its environment.' };
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { credentialsKeyCheck: true } });
  if (!org?.credentialsKeyCheck) {
    await prisma.organization.update({ where: { id: organizationId }, data: { credentialsKeyCheck: makeKeyCheck(key) } });
    return { key };
  }
  if (!keyMatchesCheck(key, org.credentialsKeyCheck)) {
    return { status: 503, error: 'The credentials key on the server does not match the one used to save these logins.' };
  }
  return { key };
}

// ── The log ──────────────────────────────────────────────────────────────────

export const logCredential = (data: {
  organizationId: string;
  credentialId: string | null;
  credentialName: string;
  userId: string;
  action: CredentialAction;
  ip?: string | null;
  detail?: string | null;
}) => prisma.credentialLog.create({ data: { ...data, ip: data.ip ?? null, detail: data.detail ?? null } });

// ── Reveal limits (decision 6) ───────────────────────────────────────────────

export const REVEAL_WINDOW_MS = 10 * 60_000;
/** Reveals one person may make in the window before a 429. */
export const REVEAL_LIMIT = 60;
/** Different logins one person may open in the window before the others are told. */
export const UNUSUAL_DISTINCT = 20;

const reveals = new Map<string, number[]>();

/** For the tests: nobody has revealed anything. */
export const resetRevealLimits = () => reveals.clear();

/** Whether this person may reveal one more now — 60 per ten minutes, in memory. */
export function takeReveal(userId: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const since = now - REVEAL_WINDOW_MS;
  const recent = (reveals.get(userId) ?? []).filter((t) => t > since);
  if (recent.length >= REVEAL_LIMIT) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + REVEAL_WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  reveals.set(userId, recent);
  return { ok: true };
}

export const CREDENTIAL_RULES = {
  unusual: 'CREDENTIAL_UNUSUAL_ACTIVITY',
  accessLost: 'CREDENTIAL_ACCESS_LOST',
} as const;

/**
 * After a reveal: has this person opened more than 20 different logins in
 * ten minutes? If so, every other Management member gets a bell — once per
 * window, not once per reveal.
 */
export async function checkUnusualActivity(organizationId: string, user: { userId: string; name: string }, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - REVEAL_WINDOW_MS);
  const rows = await prisma.credentialLog.findMany({
    where: { organizationId, userId: user.userId, action: { in: [CredentialAction.SHOW, CredentialAction.COPY] }, at: { gte: since }, credentialId: { not: null } },
    select: { credentialId: true },
  });
  const distinct = new Set((rows ?? []).map((r) => r.credentialId)).size;
  if (distinct <= UNUSUAL_DISTINCT) return false;
  const already = await prisma.alert.findFirst({
    where: { organizationId, rule: CREDENTIAL_RULES.unusual, entityType: 'User', entityId: user.userId, raisedAt: { gte: since } },
    select: { id: true },
  });
  if (already) return false;
  await prisma.alert.create({
    data: {
      organizationId,
      rule: CREDENTIAL_RULES.unusual,
      severity: 'HIGH',
      entityType: 'User',
      entityId: user.userId,
      message: `${user.name} opened ${distinct} logins in 10 minutes.`,
    },
  });
  return true;
}

/**
 * Somebody left Management — their preset changed, or their account was
 * switched off. The remaining Management members are told how many logins
 * that person had opened, with a link to the log for that person.
 */
export async function managementAccessLost(organizationId: string, person: { id: string; name: string }): Promise<boolean> {
  const rows = await prisma.credentialLog.findMany({
    where: { organizationId, userId: person.id, action: { in: [CredentialAction.SHOW, CredentialAction.COPY] }, credentialId: { not: null } },
    select: { credentialId: true },
  });
  const opened = new Set((rows ?? []).map((r) => r.credentialId)).size;
  if (opened === 0) return false;
  await prisma.alert.create({
    data: {
      organizationId,
      rule: CREDENTIAL_RULES.accessLost,
      severity: 'HIGH',
      entityType: 'User',
      entityId: person.id,
      message: `${person.name} no longer has Management access. They opened ${opened} login${opened === 1 ? '' : 's'}. Review which passwords to change →`,
    },
  });
  return true;
}

// ── The purge (decision 9) ───────────────────────────────────────────────────

export const DELETED_KEEP_DAYS = 30;
/** How long the two bells stay before closing themselves. */
const BELL_KEEP_DAYS = 30;

/** Recently deleted logins past 30 days go for good; the log keeps each name. */
export async function purgeDeletedCredentials(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - DELETED_KEEP_DAYS * 86_400_000);
  const rows = await prisma.credential.findMany({
    where: { deletedAt: { lt: before } },
    select: { id: true, organizationId: true, name: true, deletedById: true, createdById: true },
  });
  for (const r of rows ?? []) {
    await logCredential({
      organizationId: r.organizationId,
      credentialId: null,
      credentialName: r.name,
      userId: r.deletedById ?? r.createdById,
      action: CredentialAction.PURGE,
      detail: `Purged ${DELETED_KEEP_DAYS} days after deletion`,
    });
    await prisma.credential.delete({ where: { id: r.id } });
  }
  await prisma.alert.updateMany({
    where: { rule: { in: Object.values(CREDENTIAL_RULES) }, resolvedAt: null, raisedAt: { lt: new Date(now.getTime() - BELL_KEEP_DAYS * 86_400_000) } },
    data: { resolvedAt: now },
  });
  if (rows?.length) logger.info(`Logins: purged ${rows.length} deleted login${rows.length === 1 ? '' : 's'}`);
  return rows?.length ?? 0;
}

export function startCredentialPurge(intervalMs = 24 * 60 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  const run = () => purgeDeletedCredentials().catch((e) => logger.error(`Logins purge error: ${e}`));
  void run();
  setInterval(run, intervalMs);
}

// ── Import from a sheet (decision 8) ─────────────────────────────────────────

export const IMPORT_FIELDS = ['name', 'client', 'website', 'username', 'password', 'notes'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Partial<Record<ImportField, string | null>>;

/** What a column is likely to be, from its (normalised) header. First match wins, in this order. */
const GUESSES: [ImportField, string[]][] = [
  ['password', ['password', 'pass', 'pwd', 'passcode', 'passwd']],
  ['username', ['username', 'user', 'email', 'login', 'userid', 'id', 'useremail', 'loginid', 'emailid']],
  ['website', ['website', 'url', 'link', 'site', 'address', 'web']],
  ['client', ['client', 'company', 'belongsto', 'owner', 'customer', 'brand']],
  ['notes', ['notes', 'note', 'remarks', 'remark', 'comments', 'comment', 'description']],
  ['name', ['name', 'title', 'platform', 'account', 'service', 'tool', 'app', 'application']],
];

/** Flowzen's guess at which column is which. A header is used once. */
export function guessMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const [field, candidates] of GUESSES) {
    const hit = candidates.map((c) => headers.find((h) => h === c && !used.has(h))).find(Boolean) ?? candidates.map((c) => headers.find((h) => h.includes(c) && !used.has(h))).find(Boolean);
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/** Blank, "Internal", "Eyelevel" or "Us" is the studio's own. */
export const INTERNAL_WORDS = new Set(['', 'internal', 'eyelevel', 'eye level', 'us', 'own', 'ours', 'self', 'studio', 'in-house', 'inhouse']);

export const normaliseName = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** A website as a duplicate key: no scheme, no www, no trailing slash. */
export const normaliseWebsite = (s: string | null | undefined) =>
  (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

/** The duplicate key: owner + website + username. */
export const duplicateKey = (scope: CredentialScope, companyId: string | null, website: string | null | undefined, username: string | null | undefined) =>
  `${scope === CredentialScope.CLIENT ? companyId ?? '' : 'INTERNAL'}|${normaliseWebsite(website)}|${normaliseName(username)}`;

export type ImportRow = {
  row: number;
  name: string;
  clientText: string;
  /** What the client column resolved to: INTERNAL, a company id, or null when unknown. */
  client: 'INTERNAL' | string | null;
  clientName: string | null;
  website: string | null;
  username: string | null;
  hasPassword: boolean;
  hasNotes: boolean;
  status: 'OK' | 'NO_PASSWORD' | 'NO_NAME' | 'UNKNOWN_CLIENT' | 'DUPLICATE';
  reason?: string;
};

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads the sheet and says what each row would become. Nothing is saved
 * here; the passwords are held only to be counted and returned masked.
 */
export async function prepareImport(
  organizationId: string,
  csv: string,
  mappingIn: ImportMapping | undefined,
  clientChoices: Record<string, 'INTERNAL' | string> | undefined,
): Promise<{ headers: string[]; mapping: ImportMapping; rows: ImportRow[]; secrets: Map<number, { password: string; notes: string | null }> }> {
  const records = parseCsv(csv).slice(0, IMPORT_MAX_ROWS);
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const mapping = { ...guessMapping(headers), ...(mappingIn ?? {}) };
  const col = (r: Record<string, string>, f: ImportField) => (mapping[f] ? (r[mapping[f]!] ?? '').trim() : '');

  const companies = await prisma.company.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const byName = new Map((companies ?? []).map((c) => [normaliseName(c.name), c]));
  const byId = new Map((companies ?? []).map((c) => [c.id, c]));
  const existing = await prisma.credential.findMany({
    where: { organizationId, deletedAt: null },
    select: { scope: true, companyId: true, website: true, username: true },
  });
  const taken = new Set((existing ?? []).map((c) => duplicateKey(c.scope, c.companyId, c.website, c.username)));
  const seen = new Set<string>();
  const secrets = new Map<number, { password: string; notes: string | null }>();

  const rows: ImportRow[] = records.map((r, i) => {
    const rowNum = i + 2;
    const name = col(r, 'name');
    const clientText = col(r, 'client');
    const website = col(r, 'website') || null;
    const username = col(r, 'username') || null;
    const password = col(r, 'password');
    const notes = col(r, 'notes') || null;

    const choice = clientChoices?.[String(rowNum)];
    let client: ImportRow['client'];
    let clientName: string | null = null;
    if (choice === 'INTERNAL') client = 'INTERNAL';
    else if (choice && byId.has(choice)) {
      client = choice;
      clientName = byId.get(choice)!.name;
    } else if (INTERNAL_WORDS.has(normaliseName(clientText))) client = 'INTERNAL';
    else {
      const match = byName.get(normaliseName(clientText));
      client = match?.id ?? null;
      clientName = match?.name ?? null;
    }

    const base = { row: rowNum, name, clientText, client, clientName, website, username, hasPassword: Boolean(password), hasNotes: Boolean(notes) };
    if (!name) return { ...base, status: 'NO_NAME', reason: 'No name' };
    if (!password) return { ...base, status: 'NO_PASSWORD', reason: 'No password' };
    if (client === null) return { ...base, status: 'UNKNOWN_CLIENT', reason: clientText ? `No client called "${clientText}"` : 'No client' };
    const key = duplicateKey(client === 'INTERNAL' ? CredentialScope.INTERNAL : CredentialScope.CLIENT, client === 'INTERNAL' ? null : client, website, username);
    if (taken.has(key)) return { ...base, status: 'DUPLICATE', reason: 'Already saved' };
    if (seen.has(key)) return { ...base, status: 'DUPLICATE', reason: 'Twice in the file' };
    seen.add(key);
    secrets.set(rowNum, { password, notes });
    return { ...base, status: 'OK' };
  });

  return { headers, mapping, rows, secrets };
}

export type CredentialCreateData = Prisma.CredentialUncheckedCreateInput;
