import type { Tone } from '@/components/ui/badge';

/**
 * Words for stored codes that more than one screen prints.
 *
 * The company page printed them raw — PAST, APPROVER, PROFORMA_ISSUED with the
 * underscores turned to spaces — beside screens that had each written their
 * own words for the same thing. An expired proforma was grey on Proposals, red
 * on the billing board and amber, the colour of "waiting for payment", on the
 * client's own page. One copy here, so the same record reads the same way
 * wherever it is found.
 */

export const COMPANY_STATUS_LABEL: Record<string, string> = {
  PROSPECT: 'Prospect',
  CLIENT: 'Client',
  PAST: 'Past client',
};

export const CONTACT_ROLE_LABEL: Record<string, string> = {
  CONTACT: 'Contact',
  APPROVER: 'Approver',
  PAYER: 'Payer',
};

/** What each role means, for the forms that ask. */
export const CONTACT_ROLE_OPTIONS = [
  { value: 'CONTACT', label: 'Contact — the person you deal with' },
  { value: 'APPROVER', label: 'Approver — signs the work off' },
  { value: 'PAYER', label: 'Payer — who the invoice goes to' },
];

export const PROFORMA_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Unpaid',
  PAID: 'Paid',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

/**
 * Only Unpaid wears the "waiting for money" colour. Expired and Cancelled are
 * both requests that no longer stand, so neither looks like money coming in.
 */
export const PROFORMA_STATUS_TONE: Record<string, Tone> = {
  UNPAID: 'warn',
  PAID: 'good',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

export const RETAINER_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  STOPPED: 'Stopped',
};

/** The word for a code, or the code in sentence case when a map has no entry yet. */
export const wordFor = (map: Record<string, string>, v?: string | null): string => {
  if (!v) return '—';
  if (map[v]) return map[v];
  const spaced = v.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
