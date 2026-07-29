// Helpers for list-endpoint filters that accept either a single value
// (e.g. ?status=ACTIVE) or a comma-separated list (?status=ACTIVE,ONHOLD).
// This keeps old single-value URLs/links working while enabling multi-select filters.

/** Parse a query param into a trimmed string array, or undefined when empty. */
export function toList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const arr = v.map((s) => String(s).trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const arr = v.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

/**
 * Build a Prisma where-value from a single/CSV query param:
 * one value -> equality, many -> { in: [...] }, empty -> undefined (no filter).
 */
export function whereIn(v: unknown): string | { in: string[] } | undefined {
  const arr = toList(v);
  if (!arr) return undefined;
  return arr.length === 1 ? arr[0] : { in: arr };
}

/**
 * Clamp raw `page`/`limit` query params into a safe range for `skip`/`take` (FZ-023).
 * Guards against NaN, zero/negative, and unbounded page sizes — a `?limit=99999999`
 * would otherwise let a single request try to load an entire table.
 */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; skip: number; take: number } {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 100;

  const rawPage = Number.parseInt(String(query.page ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, maxLimit) : defaultLimit;

  return { page, limit, skip: (page - 1) * limit, take: limit };
}
