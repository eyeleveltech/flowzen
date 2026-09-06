/**
 * The enum on one side, the words a person reads on the other.
 *
 * `CompanyVertical` is stored SCREAMING_SNAKE, and two screens each did their
 * own thing with it: the companies table swapped underscores for spaces and
 * shouted the result — HOSPITALITY, REAL ESTATE, IT AND SAAS — while the
 * outreach list had already been given a map and read "Healthcare".
 *
 * Spelled out rather than derived, because deriving gets the acronyms wrong in
 * both directions: title-casing IT_AND_SAAS produces "It And Saas", and
 * lower-casing D2C and B2B ruins the two that were right to begin with.
 */
export const VERTICAL_LABEL: Record<string, string> = {
  HEALTHCARE: 'Healthcare',
  REAL_ESTATE: 'Real estate',
  D2C: 'D2C',
  SPORTS: 'Sports',
  IT_AND_SAAS: 'IT & SaaS',
  RETAIL: 'Retail',
  B2B: 'B2B',
  HOSPITALITY: 'Hospitality',
};

export const SOURCE_LABEL: Record<string, string> = {
  OUTREACH: 'Outreach',
  REFERRAL: 'Referral',
  INBOUND: 'Inbound',
  PARTNER_AGENCY: 'Partner agency',
  NETWORK: 'Network',
};

/** Falls back to the raw value, so an enum member added later shows rather than vanishing. */
export const labelFor = (map: Record<string, string>, v?: string | null): string =>
  !v ? '—' : (map[v] ?? v.replace(/_/g, ' '));

export const verticalLabel = (v?: string | null) => labelFor(VERTICAL_LABEL, v);
export const sourceLabel = (v?: string | null) => labelFor(SOURCE_LABEL, v);

export const asOptions = (map: Record<string, string>) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));

export const VERTICAL_OPTIONS = asOptions(VERTICAL_LABEL);
export const SOURCE_OPTIONS = asOptions(SOURCE_LABEL);
