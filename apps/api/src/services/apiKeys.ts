import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PermissionKey } from '@flowzen/shared';
import { hasPermission, type UserSession } from '../middleware/auth.js';

/**
 * API keys (API Plan 1): what one looks like, how it is stored, and what it may
 * do.
 *
 * A key is `fz_live_` and 32 random bytes in base62. Only an HMAC of it is
 * kept, keyed with API_KEY_PEPPER from the environment, so the database on its
 * own cannot be turned back into working keys. The admin sees the whole key
 * once, when it is made, and only its visible start after that.
 *
 * A key acts as the person who made it. Its scopes say which of that person's
 * powers it carries, and each scope is re-checked against their permissions on
 * every request — a key cannot do more than its creator can do today.
 */

export const KEY_PREFIX = 'fz_live_';

/** The most keys an organisation may have working at once. Revoked and expired ones do not count. */
export const MAX_ACTIVE_KEYS = 20;

/** How long a new key lasts. */
export const EXPIRY_DAYS = { '30d': 30, '90d': 90, '1y': 365, never: null } as const;
export type ExpiryChoice = keyof typeof EXPIRY_DAYS;

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Every scope a key can carry, and the app permission its creator needs for
 * it. Any one of `needs` is enough: `tasks:read` is open to anybody who holds
 * their own work, and how WIDE it reads (their own, their department, the
 * whole studio) is decided by the same rules as the app.
 *
 * Never available, at any price: salaries and cost rates, people
 * administration, Settings, deleting anything, usage tracking, Zen, and money
 * writes. There is no scope for any of them, so no key can be given one.
 */
export const API_SCOPES = [
  {
    key: 'tasks:read',
    group: 'Tasks',
    label: 'Read tasks',
    description: 'List and open tasks, and the internal projects they sit in.',
    needs: ['work.own', 'work.team', 'work.all'],
  },
  {
    key: 'tasks:write',
    group: 'Tasks',
    label: 'Create and update tasks',
    description: 'Create tasks; change title, notes, due date, priority, people and status. Never delete.',
    needs: ['work.own', 'work.team', 'work.all'],
  },
  {
    key: 'work:read',
    group: 'Work',
    label: 'Read projects and retainers',
    description: 'Retainers, one-time projects and internal projects: names, dates and progress. No fees.',
    needs: ['work.all'],
  },
  {
    key: 'clients:read',
    group: 'Clients',
    label: 'Read companies',
    description: 'Companies and their contacts.',
    needs: ['company.read'],
  },
  {
    key: 'leads:read',
    group: 'Leads',
    label: 'Read outreach leads',
    description: 'The outreach list.',
    needs: ['company.read'],
  },
  {
    key: 'leads:write',
    group: 'Leads',
    label: 'Add and update leads',
    description: 'Add leads, change their status and next step, and log a touch.',
    needs: ['company.write'],
  },
  {
    key: 'pipeline:read',
    group: 'Pipeline',
    label: 'Read deals',
    description: 'Deals and their stages. Values only for people who may see them.',
    needs: ['pipeline.read'],
  },
  {
    key: 'pipeline:write',
    group: 'Pipeline',
    label: 'Log touches on deals',
    description: 'Log a touch and set the next step. No stage moves, won or lost, or pricing.',
    needs: ['pipeline.write'],
  },
  {
    key: 'calendar:read',
    group: 'Calendar',
    label: 'Read the calendar',
    description: 'Meetings and shoots. Google busy time shows only as "Busy".',
    needs: ['work.own'],
  },
  {
    key: 'calendar:write',
    group: 'Calendar',
    label: 'Book and move events',
    description: 'Book meetings and shoots, and move them. Never cancel or delete.',
    needs: ['work.own'],
  },
  {
    key: 'money:read',
    group: 'Money',
    label: 'Read invoices and payments',
    description: 'Invoices, proformas, payments and what is owed. Amounts only for people who may see figures.',
    needs: ['money.status'],
  },
] as const satisfies readonly {
  key: string;
  group: string;
  label: string;
  description: string;
  needs: readonly PermissionKey[];
}[];

export type ApiScope = (typeof API_SCOPES)[number]['key'];

export const SCOPE_KEYS = API_SCOPES.map((s) => s.key) as [ApiScope, ...ApiScope[]];

export const isScope = (v: unknown): v is ApiScope => typeof v === 'string' && (SCOPE_KEYS as string[]).includes(v);

type ScopeUser = Pick<UserSession, 'userId' | 'organizationId' | 'preset' | 'permissions' | 'active'>;

/** Whether this person holds the permission a scope needs. */
export const scopeAllowed = (user: ScopeUser, scope: ApiScope): boolean =>
  API_SCOPES.find((s) => s.key === scope)!.needs.some((p) => hasPermission(user as UserSession, p));

/** The scopes this person could tick on a key — the creator's side of "scope ∩ permission". */
export const scopesFor = (user: ScopeUser): ApiScope[] => SCOPE_KEYS.filter((s) => scopeAllowed(user, s));

/**
 * What a key may actually do right now: the scopes ticked on it that its
 * creator still holds the permission for. Stored values that are not scopes
 * any more are dropped rather than trusted.
 */
export const effectiveScopes = (stored: readonly string[], user: ScopeUser): ApiScope[] =>
  SCOPE_KEYS.filter((s) => stored.includes(s) && scopeAllowed(user, s));

// ── The key itself ───────────────────────────────────────────────────────────

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 32 bytes is 256 bits; 43 base62 characters hold 256.03 of them. */
const SECRET_LENGTH = 43;

/** Bytes as base62, left-padded so every key is the same length. */
export function base62(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(SECRET_LENGTH, '0');
}

/** The shape every key has. Anything else is refused before the database is asked. */
export const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}[0-9A-Za-z]{${SECRET_LENGTH}}$`);

/** A server without API_KEY_PEPPER in production cannot make or check keys. */
export class ApiKeysUnavailable extends Error {
  constructor() {
    super('API keys are not set up on this server: API_KEY_PEPPER is missing or too short.');
  }
}

/**
 * The secret mixed into every key's hash.
 *
 * Required in production — a missing one is a deployment mistake, and keys
 * hashed without it would all stop working the day it is added. Development
 * and tests get a fixed stand-in so nobody needs a .env line to run the app.
 */
export function pepper(): string {
  const value = process.env.API_KEY_PEPPER?.trim();
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === 'production') throw new ApiKeysUnavailable();
  return 'flowzen-development-api-key-pepper-not-for-production';
}

export const hashKey = (key: string): string => createHmac('sha256', pepper()).update(key).digest('hex');

/** Two hashes compared without leaking, through timing, how much of them matched. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A new key: the whole of it (shown once), what is stored, and the visible start. */
export function generateKey(): { key: string; keyHash: string; prefix: string } {
  const key = `${KEY_PREFIX}${base62(randomBytes(32))}`;
  return { key, keyHash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 8) };
}

/** When a key made now with this choice stops working, or null for never. */
export function expiryFrom(choice: ExpiryChoice, now = new Date()): Date | null {
  const days = EXPIRY_DAYS[choice];
  return days === null ? null : new Date(now.getTime() + days * 86_400_000);
}

export type KeyStatus = 'active' | 'revoked' | 'expired';

export const keyStatus = (key: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): KeyStatus =>
  key.revokedAt ? 'revoked' : key.expiresAt && key.expiresAt <= now ? 'expired' : 'active';
