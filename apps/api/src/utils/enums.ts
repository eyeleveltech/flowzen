import { CompanyVertical } from '@prisma/client';
import { normaliseHeader } from './csv.js';

/**
 * Match a spreadsheet cell to an enum member, forgivingly.
 *
 * "Real Estate", "real-estate" and "REAL_ESTATE" are one answer typed three
 * ways. A bulk import that rejects a file over punctuation is one nobody uses
 * twice, so the comparison is on the normalised form and a small alias table
 * covers the words people actually write instead of the enum's own.
 */
export function matchEnumValue<T extends string>(
  raw: string | undefined,
  values: readonly T[],
  aliases: Record<string, T> = {},
): T | null {
  if (!raw) return null;
  const norm = normaliseHeader(raw);
  if (aliases[norm]) return aliases[norm];
  return values.find((v) => normaliseHeader(v) === norm) ?? null;
}

export const VERTICAL_ALIASES: Record<string, CompanyVertical> = {
  saas: CompanyVertical.IT_AND_SAAS,
  it: CompanyVertical.IT_AND_SAAS,
  tech: CompanyVertical.IT_AND_SAAS,
  technology: CompanyVertical.IT_AND_SAAS,
  software: CompanyVertical.IT_AND_SAAS,
  ecommerce: CompanyVertical.D2C,
  realty: CompanyVertical.REAL_ESTATE,
  realestate: CompanyVertical.REAL_ESTATE,
  property: CompanyVertical.REAL_ESTATE,
  hotel: CompanyVertical.HOSPITALITY,
  hotels: CompanyVertical.HOSPITALITY,
  restaurant: CompanyVertical.HOSPITALITY,
  hospital: CompanyVertical.HEALTHCARE,
  hospitals: CompanyVertical.HEALTHCARE,
  clinic: CompanyVertical.HEALTHCARE,
  medical: CompanyVertical.HEALTHCARE,
  fitness: CompanyVertical.SPORTS,
  sport: CompanyVertical.SPORTS,
};
