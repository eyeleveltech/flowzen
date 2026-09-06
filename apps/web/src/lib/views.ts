'use client';

/**
 * Saved views.
 *
 * ─── What a view is ─────────────────────────────────────────────────────────
 *
 * A name and a query string. Nothing else.
 *
 * That is worth stating, because the obvious design is a record with a field per
 * filter — status, assignee, overdue, due — which then has to be extended every
 * time a screen learns a new filter, and quietly drops the ones it has not heard
 * of. Storing the query string means a view captures whatever the URL can
 * express, today and after the next filter is added, and applying one is a
 * navigation rather than a dozen setState calls that have to be kept in step.
 *
 * It also means views compose with the drill-through links from Today: arrive at
 * a filtered list from a number, decide you want it every morning, save it.
 *
 * ─── Where they live ────────────────────────────────────────────────────────
 *
 * `localStorage`, per person, per screen.
 *
 * Deliberately not the database yet. The rebuild plan holds the schema still
 * apart from two columns on `projects`, and a per-person list of named filters is
 * exactly the kind of thing that should be proved useful before it earns a table.
 *
 * What that costs, plainly: views do not follow you to another browser, and
 * nobody can publish one for the team. Both need a `saved_views` table, and both
 * are worth doing IF these get used.
 */

export type SavedView = {
  id: string;
  name: string;
  /** The query string, without the leading "?". May be empty — that is "no filters". */
  query: string;
};

const KEY = (page: string) => `flowzen-views:${page}`;

/** Reading never throws. Private windows and cleared storage are normal. */
export const readViews = (page: string): SavedView[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY(page));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView =>
        Boolean(v) &&
        typeof (v as SavedView).id === 'string' &&
        typeof (v as SavedView).name === 'string' &&
        typeof (v as SavedView).query === 'string',
    );
  } catch {
    return [];
  }
};

const writeViews = (page: string, views: SavedView[]): void => {
  try {
    window.localStorage.setItem(KEY(page), JSON.stringify(views));
  } catch {
    // Storage full, or blocked. The view is lost; the screen still works.
  }
};

/**
 * Save the current filters under a name.
 *
 * Saving the same NAME twice overwrites, rather than leaving two entries called
 * "My attention" that differ in ways nobody can see from the list.
 */
export const saveView = (page: string, name: string, query: string): SavedView[] => {
  const trimmed = name.trim();
  if (!trimmed) return readViews(page);

  const existing = readViews(page);
  const match = existing.find((v) => v.name.toLowerCase() === trimmed.toLowerCase());

  const next = match
    ? existing.map((v) => (v.id === match.id ? { ...v, query } : v))
    : [...existing, { id: `${Date.now()}-${existing.length}`, name: trimmed, query }];

  writeViews(page, next);
  return next;
};

export const removeView = (page: string, id: string): SavedView[] => {
  const next = readViews(page).filter((v) => v.id !== id);
  writeViews(page, next);
  return next;
};

/**
 * Whether a view describes what is on screen right now.
 *
 * Compared as SORTED key/value pairs, not as strings: `?mine=1&overdue=1` and
 * `?overdue=1&mine=1` are the same view, and a screen that rewrites its own URL
 * has no reason to preserve the order somebody happened to save.
 */
export const sameQuery = (a: string, b: string): boolean => {
  const norm = (q: string) =>
    [...new URLSearchParams(q).entries()]
      .filter(([k]) => k !== 'create')
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  return norm(a) === norm(b);
};
