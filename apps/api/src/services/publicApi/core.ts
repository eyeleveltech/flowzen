import { z } from 'zod';
import type { UserSession } from '../../middleware/auth.js';
import type { ApiScope } from '../apiKeys.js';
import type { ApiRequest } from '../../middleware/apiKey.js';

/**
 * What every public API read and write shares (API Plan 1, decision 4): who is
 * asking, the error shape, cursor paging, and the app link on every record.
 *
 * The REST routes (routes/apiV1.ts) and the MCP tools (routes/mcp.ts) both call
 * the functions built on this, so a task reads the same through either door.
 */

/**
 * Who a call runs as: the key's creator, carrying the key's scopes — or, for
 * a connected app (API Plan 2), the person who signed in, carrying what they
 * ticked. `kind` says which; `id` is the key's or the grant's.
 */
export type ApiContext = {
  user: UserSession;
  key: { kind: 'key' | 'connector'; id: string; name: string; prefix: string; scopes: ApiScope[] };
  /** The request itself, for running a write through the app's own route. */
  req: ApiRequest;
};

/** A refusal with a status and a machine-readable code: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found.`);

/** The app's address, for turning a screen path into a link somebody can open. */
export const appUrl = (): string =>
  (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** An absolute link for a screen path, or null when there is no screen this person can open. */
export const absoluteLink = (path: string | null): string | null => (path ? `${appUrl()}${path}` : null);

/** `@db.Date` columns as the calendar day they are. */
export const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type PersonRef = { id: string; name: string };
export const person = (u: { id: string; name: string } | null | undefined): PersonRef | null =>
  u ? { id: u.id, name: u.name } : null;

// ── Paging and polling ───────────────────────────────────────────────────────

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 50;
/** What an MCP tool hands an AI at most, so one answer never floods its context. */
export const MCP_LIMIT = 50;

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO date or date-time, like 2026-11-03T09:00:00Z.');

/**
 * The query every list takes.
 *
 * `updatedSince` / `createdSince` are what an automation's "new or updated
 * item" trigger polls with (decision 7): the list comes back oldest first by
 * that column, so the last row seen is the next poll's starting point.
 */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(`At most ${MAX_LIMIT}.`),
  cursor: z.string().min(1).optional().describe('The `nextCursor` from the previous page.'),
  updatedSince: isoDateTime.optional().describe('Only records changed at or after this moment, oldest change first.'),
  createdSince: isoDateTime.optional().describe('Only records created at or after this moment, oldest first.'),
  order: z.enum(['asc', 'desc']).default('asc').describe('asc (the default) is oldest first; desc is newest first.'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

type Cursor = { f: 'createdAt' | 'updatedAt'; d: 'asc' | 'desc'; v: string; id: string };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      (c.f === 'createdAt' || c.f === 'updatedAt') &&
      (c.d === 'asc' || c.d === 'desc') &&
      typeof c.v === 'string' &&
      !Number.isNaN(Date.parse(c.v)) &&
      typeof c.id === 'string'
    ) {
      return c;
    }
  } catch {
    // Falls through to the refusal.
  }
  throw new ApiError(400, 'invalid_cursor', 'That cursor is not one this API gave out. Start again without it.');
}

/**
 * The where, order and take for one page.
 *
 * `columns` names a model's own columns: an outreach lead was "created" when
 * it was imported, and a payment is never edited, so its update is its
 * creation. The cursor carries the column and direction it was made with, and
 * a cursor from one ordering is refused by another rather than skipping rows.
 */
export function pageArgs(
  q: ListQuery,
  columns: { createdAt: string; updatedAt: string } = { createdAt: 'createdAt', updatedAt: 'updatedAt' },
) {
  const field: Cursor['f'] = q.updatedSince ? 'updatedAt' : 'createdAt';
  const column = columns[field];
  const dir = q.order;
  const where: Record<string, unknown>[] = [];
  if (q.updatedSince) where.push({ [columns.updatedAt]: { gte: new Date(q.updatedSince) } });
  if (q.createdSince) where.push({ [columns.createdAt]: { gte: new Date(q.createdSince) } });
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    if (c.f !== field || c.d !== dir) {
      throw new ApiError(400, 'invalid_cursor', 'That cursor belongs to a different ordering. Send the same filters as the page it came from.');
    }
    const op = dir === 'asc' ? 'gt' : 'lt';
    const at = new Date(c.v);
    where.push({ OR: [{ [column]: { [op]: at } }, { [column]: at, id: { [op]: c.id } }] });
  }
  return {
    where,
    orderBy: [{ [column]: dir }, { id: dir }] as Record<string, 'asc' | 'desc'>[],
    // One extra row says whether there is another page.
    take: q.limit + 1,
    /** The page, and the cursor for the next one. The rows must carry the column ordered on. */
    finish<T extends { id: string }>(rows: T[]): { rows: T[]; nextCursor: string | null } {
      const more = rows.length > q.limit;
      const page = more ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      const at = last ? (last as unknown as Record<string, unknown>)[column] : null;
      return {
        rows: page,
        nextCursor: more && at instanceof Date ? encodeCursor({ f: field, d: dir, v: at.toISOString(), id: last!.id }) : null,
      };
    },
  };
}

/** `{ data, nextCursor }`, the shape every list answers with. */
export type Page<T> = { data: T[]; nextCursor: string | null };
