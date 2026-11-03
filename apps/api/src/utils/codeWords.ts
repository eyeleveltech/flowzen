import { LEGACY_INDUSTRY, LEGACY_SOURCE, STAGE_LABEL } from '@flowzen/shared';

/**
 * Words for stored codes, for the CSV exports.
 *
 * The exports printed the database's own values — PAST, NOT_CONTACTED,
 * PROFORMA_ISSUED, COMPANY_EXPENSE — under headings like "Vertical" that no
 * screen uses, so a spreadsheet handed to somebody outside the app needed the
 * app's source to read. The screens say "Past client", "Not contacted",
 * "Proforma Issued / Contract Sent"; so do the files now.
 *
 * Most codes read fine sentence-cased. The maps are only for the ones that do
 * not: names, acronyms, and words the studio chose.
 */

export const COMPANY_STATUS_WORD: Record<string, string> = { PROSPECT: 'Prospect', CLIENT: 'Client', PAST: 'Past client' };
export const TASK_STATUS_WORD: Record<string, string> = { TODO: 'To do' };
export const WORK_TYPE_WORD: Record<string, string> = { MONTH_CARD: 'Retainer', PROJECT: 'Project', INTERNAL: 'Internal' };
export const COST_TYPE_WORD: Record<string, string> = { DIRECT: 'Client', COMPANY: 'Company', CAPITAL: 'Capital' };
export const COST_TREATMENT_WORD: Record<string, string> = {
  COMPANY_EXPENSE: 'Company expense',
  AKMAL_LOAN: 'Akmal loan',
  N_J_MACSON_LOAN: 'N J Macson loan',
};
export { STAGE_LABEL as STAGE_WORD };

/** A code in words: the map's word, else the code sentence-cased. Blank stays blank. */
export const codeWord = (v: string | null | undefined, map: Record<string, string> = {}): string => {
  if (!v) return '';
  if (map[v]) return map[v];
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) return v;
  const spaced = v.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** An industry or source: stored as words now, but an old row may still carry REAL_ESTATE. */
export const listWord = (v: string | null | undefined): string =>
  !v ? '' : (LEGACY_INDUSTRY[v] ?? LEGACY_SOURCE[v] ?? v);
