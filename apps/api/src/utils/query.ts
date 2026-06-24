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
