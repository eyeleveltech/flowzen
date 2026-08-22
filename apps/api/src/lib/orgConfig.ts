/**
 * An organisation's configuration, loaded once and cached.
 *
 * Every date boundary, money format, tax split and document number reads from
 * here rather than from a constant (master plan §3.11). Before this, 37 places
 * across 9 files assumed India — which is fine until it isn't, and is the kind of
 * assumption that is expensive to unpick later rather than now.
 *
 * Cached because it is read on nearly every request and changes rarely. The cache
 * is invalidated explicitly on update, not by a TTL: a stale timezone would move
 * every "due today" boundary for however long the TTL was, and nobody would
 * connect the two.
 */

import { prisma } from './prisma.js';
import { isValidTimeZone } from '../utils/orgDay.js';

export type OrgConfig = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  dateFormat: string;
  fiscalYearStart: number; // 1-12
  documentPrefix: string;
  state: string | null;
  gstNumber: string | null;
};

const cache = new Map<string, OrgConfig>();

/**
 * Fallbacks used only when a column is somehow empty. They are not "the defaults
 * for everyone" — the schema already defaults these — but a null here would
 * otherwise crash date formatting on a half-created organisation.
 */
const FALLBACK = {
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  locale: 'en-IN',
  dateFormat: 'dd MMM yyyy',
  fiscalYearStart: 4,
  documentPrefix: 'FZ',
} as const;

export const getOrgConfig = async (organizationId: string): Promise<OrgConfig> => {
  const cached = cache.get(organizationId);
  if (cached) return cached;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      currency: true,
      timezone: true,
      locale: true,
      dateFormat: true,
      fiscalYearStart: true,
      documentPrefix: true,
      state: true,
      gstNumber: true,
    },
  });

  if (!org) throw new Error(`Organisation ${organizationId} not found`);

  // An invalid zone name is corrected rather than allowed to throw deep inside a
  // date calculation, where the stack trace would say nothing useful. It is
  // logged because it means the settings screen let something through.
  let timezone = org.timezone || FALLBACK.timezone;
  if (!isValidTimeZone(timezone)) {
    console.error(
      `[orgConfig] Organisation ${organizationId} has an unusable timezone "${timezone}". ` +
        `Falling back to ${FALLBACK.timezone}. Fix it in Settings.`,
    );
    timezone = FALLBACK.timezone;
  }

  const config: OrgConfig = {
    id: org.id,
    name: org.name,
    currency: org.currency || FALLBACK.currency,
    timezone,
    locale: org.locale || FALLBACK.locale,
    dateFormat: org.dateFormat || FALLBACK.dateFormat,
    fiscalYearStart: org.fiscalYearStart || FALLBACK.fiscalYearStart,
    documentPrefix: org.documentPrefix || FALLBACK.documentPrefix,
    state: org.state,
    gstNumber: org.gstNumber,
  };

  cache.set(organizationId, config);
  return config;
};

/** Call after any write to organisation settings. */
export const invalidateOrgConfig = (organizationId: string): void => {
  cache.delete(organizationId);
};

/** For tests, and for a process that has just changed many organisations. */
export const clearOrgConfigCache = (): void => cache.clear();
