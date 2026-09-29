/**
 * What an edit changed, as the activity log stores it: `{ field: { from, to } }`.
 *
 * Several edit routes used to log only the NAMES of the fields sent — "fields:
 * [name, endDate]" — which answers "was this touched" and nothing a person
 * brings to the log a month later: what was the end date before, and who moved
 * it. Tasks already stored from → to; this is that, for everything else.
 *
 * Only fields that actually changed are kept. A form that sends every field
 * back on save would otherwise log "changed the name from X to X".
 */

export type Change = { from: unknown; to: unknown };

/** A value as it should sit in JSON and compare: dates as days, decimals as numbers. */
const plain = (v: unknown): unknown => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Prisma.Decimal, without importing Prisma for one duck-type.
  if (typeof v === 'object' && v !== null && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (v === '') return null;
  return v;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The changed fields between the row before and the values written.
 *
 * `after` is what was SENT (the parsed body), so a field the form left out is
 * not a change. `keys` narrows it further when the body carries things that are
 * not columns, or columns the log should not repeat (a password hash).
 */
export function changesBetween(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[] = Object.keys(after),
): Record<string, Change> {
  const out: Record<string, Change> = {};
  for (const k of keys) {
    if (!(k in after) || after[k] === undefined) continue;
    const from = plain(before[k]);
    const to = plain(after[k]);
    if (!same(from, to)) out[k] = { from, to };
  }
  return out;
}
