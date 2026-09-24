import { INDUSTRIES, LEAD_SOURCES, LEGACY_INDUSTRY, LEGACY_SOURCE } from '@flowzen/shared';

/**
 * Industries and lead sources, for the screens that offer and display them.
 *
 * ─── Why this file barely does anything now ─────────────────────────────────
 *
 * It used to hold two maps translating SCREAMING_SNAKE enum members into words
 * — `IT_AND_SAAS` to "IT & SaaS" — because deriving them got the acronyms wrong
 * in both directions: title-casing produces "It And Saas", and lower-casing
 * ruins D2C and B2B. Thirteen values, spelled out by hand.
 *
 * The lists are now sixty-seven industries and fourteen sources, and they are
 * stored as the words themselves. A hand-written map of that size would BE the
 * feature, and a second copy of the list is a second thing to keep in step. So
 * the display value is the stored value, and the options come straight from
 * `@flowzen/shared` — one list, read by the API's validation and by these
 * dropdowns.
 *
 * What survives is the legacy translation. Rows written before the change
 * carry `REAL_ESTATE`, and a database somewhere may not have run the migration
 * yet, so a raw enum member still renders as its new name rather than shouting.
 */

/** A value that predates the lists, shown as whatever it became. */
const legacy = (v: string): string => LEGACY_INDUSTRY[v] ?? LEGACY_SOURCE[v] ?? v.replace(/_/g, ' ');

/**
 * What to show for a stored value.
 *
 * The map argument is kept for the callers that still pass one; it is consulted
 * first, then the legacy names, then the value itself — which is the common
 * case now, since an industry IS its own label.
 */
export const labelFor = (map: Record<string, string>, v?: string | null): string =>
  !v ? '—' : (map[v] ?? legacy(v));

export const industryLabel = (v?: string | null) => (!v ? '—' : legacy(v));
export const sourceLabel = (v?: string | null) => (!v ? '—' : legacy(v));

/** Kept under the old name while `vertical` is still what the column is called. */
export const verticalLabel = industryLabel;

const optionsFrom = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

export const INDUSTRY_OPTIONS = optionsFrom(INDUSTRIES);
export const SOURCE_OPTIONS = optionsFrom(LEAD_SOURCES);

/** The old export name, still imported by the outreach screen. */
export const VERTICAL_OPTIONS = INDUSTRY_OPTIONS;

/*
 * The two label maps are gone — a stored value is its own label — but the
 * outreach screen passes them to `labelFor`, so they stay as empty maps rather
 * than becoming two more copies of the lists. `labelFor` falls through to the
 * value, which is the right answer.
 */
export const VERTICAL_LABEL: Record<string, string> = {};
export const SOURCE_LABEL: Record<string, string> = {};
