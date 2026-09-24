import {
  DEFAULT_INDUSTRY,
  DEFAULT_LEAD_SOURCE,
  INDUSTRIES,
  LEAD_SOURCES,
  LEGACY_INDUSTRY,
  LEGACY_SOURCE,
  type Industry,
  type LeadSource,
} from '@flowzen/shared';
import { z } from 'zod';
import { normaliseHeader } from './csv.js';

/**
 * Match a spreadsheet cell to a value from a fixed list, forgivingly.
 *
 * "Real Estate", "real-estate" and "REAL_ESTATE" are one answer typed three
 * ways. A bulk import that rejects a file over punctuation is one nobody uses
 * twice, so the comparison is on the normalised form and a small alias table
 * covers the words people actually write instead of the list's own.
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

/**
 * The shorthand people write instead of an industry's full name.
 *
 * Deliberately short. With sixty-seven industries, most of which say what they
 * are, the alias table's job is no longer to cover the list — it is to catch
 * the handful of words a spreadsheet actually contains that would otherwise
 * fall through to the default and be silently wrong.
 */
const INDUSTRY_ALIASES: Record<string, Industry> = {
  saas: 'Technology & SaaS',
  it: 'Technology & SaaS',
  itsaas: 'Technology & SaaS',
  tech: 'Technology & SaaS',
  technology: 'Technology & SaaS',
  software: 'Technology & SaaS',
  ai: 'AI & Emerging Technology',
  ecommerce: 'E-commerce & D2C',
  d2c: 'E-commerce & D2C',
  realty: 'Real Estate & Infrastructure',
  realestate: 'Real Estate & Infrastructure',
  property: 'Real Estate & Infrastructure',
  hotel: 'Hotels & Resorts',
  hotels: 'Hotels & Resorts',
  restaurant: 'Restaurants & QSR',
  restaurants: 'Restaurants & QSR',
  hospital: 'Healthcare & Wellness',
  hospitals: 'Healthcare & Wellness',
  clinic: 'Healthcare & Wellness',
  medical: 'Healthcare & Wellness',
  healthcare: 'Healthcare & Wellness',
  pharma: 'Pharmaceuticals',
  fitness: 'Sports & Fitness',
  sport: 'Sports & Fitness',
  sports: 'Sports & Fitness',
  fashion: 'Fashion & Apparel',
  apparel: 'Fashion & Apparel',
  jewellery: 'Jewellery & Luxury',
  jewelry: 'Jewellery & Luxury',
  education: 'Education & EdTech',
  edtech: 'Education & EdTech',
  fintech: 'Financial Services & FinTech',
  b2b: 'Corporate & B2B',
  retail: 'Retail',
  media: 'Media & Entertainment',
  gaming: 'Gaming & Esports',
  logistics: 'Logistics & Supply Chain',
  manufacturing: 'Manufacturing & Industrial',
  automotive: 'Automotive & Mobility',
  ngo: 'NGOs & Social Impact',
  events: 'Events & Experiential',
};

const SOURCE_ALIASES: Record<string, LeadSource> = {
  inbound: 'Website / Inbound',
  website: 'Website / Inbound',
  outreach: 'Cold Outreach',
  cold: 'Cold Outreach',
  referral: 'Referrals',
  partner: 'Partnerships',
  partneragency: 'Partnerships',
  network: 'Networking & Events',
  networking: 'Networking & Events',
  social: 'Social Media',
  ads: 'Paid Ads',
  seo: 'Google / SEO',
  google: 'Google / SEO',
  email: 'Email Marketing',
  wom: 'Word of Mouth',
};

/**
 * Whatever somebody wrote, matched against the list — or null.
 *
 * Tries three things in order, because a value can arrive from three places: a
 * dropdown (the exact name), a spreadsheet (a rough word), or a row written
 * before industries were a list at all (`REAL_ESTATE`). The legacy names are
 * checked BEFORE the aliases, since they are exact and unambiguous.
 */
export const matchIndustry = (raw: string | undefined | null): Industry | null =>
  (raw ? LEGACY_INDUSTRY[raw.trim()] : undefined) ??
  matchEnumValue(raw ?? undefined, INDUSTRIES, INDUSTRY_ALIASES);

export const matchLeadSource = (raw: string | undefined | null): LeadSource | null =>
  (raw ? LEGACY_SOURCE[raw.trim()] : undefined) ??
  matchEnumValue(raw ?? undefined, LEAD_SOURCES, SOURCE_ALIASES);

/**
 * The same, but never empty-handed.
 *
 * The two importers disagree on purpose about what an unreadable industry
 * means. A company CSV defaults it, because the row still names a real
 * business and a wrong industry is one click to fix on a record you can see.
 * An outreach CSV refuses the row, because a lead is barely more than a name
 * and an industry it invented is a lead nobody can qualify. So outreach uses
 * `matchIndustry` and reports the miss; everything else uses these.
 */
export const resolveIndustry = (raw: string | undefined | null): Industry =>
  matchIndustry(raw) ?? DEFAULT_INDUSTRY;

export const resolveLeadSource = (raw: string | undefined | null): LeadSource =>
  matchLeadSource(raw) ?? DEFAULT_LEAD_SOURCE;

/**
 * Zod schemas that take a legacy value as well as a current one.
 *
 * The lists changed under a running system. Anything already holding an old
 * value — a bookmarked `?vertical=SPORTS`, an API caller, a form posted from a
 * tab opened before the deploy — would otherwise get a 400 on a value that was
 * correct when it was written, which is a worse failure than accepting it.
 *
 * So the value is matched first and only then validated: `SPORTS` arrives as
 * `Sports & Fitness`, and something that is neither is still refused.
 */
export const industrySchema = z.preprocess(
  (v) => (typeof v === 'string' ? (matchIndustry(v) ?? v) : v),
  z.enum(INDUSTRIES),
);

export const leadSourceSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (matchLeadSource(v) ?? v) : v),
  z.enum(LEAD_SOURCES),
);
