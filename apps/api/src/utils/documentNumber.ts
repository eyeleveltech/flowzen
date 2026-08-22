/**
 * Sequential document numbers — EL/QT/2026-27/005.
 *
 * The allocation itself was already correct in the old system (§3.13) and is kept
 * exactly: one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so the counter
 * is read and incremented in a single statement and two people clicking at the
 * same instant cannot be handed the same number.
 *
 * Two things that were wrong are fixed:
 *
 *   1. The `EL/` prefix was hardcoded (§1.3 ⑧). It now comes from the organisation.
 *   2. The period was the SERVER's calendar year. It is now the organisation's
 *      FISCAL year, in its own timezone — so a document raised at 00:30 on 1 April
 *      in Chennai belongs to the new financial year rather than the old one, and a
 *      UTC-deployed container does not silently disagree with the accountant.
 */

import { prisma } from '../lib/prisma.js';
import { getOrgConfig } from '../lib/orgConfig.js';
import { localParts } from './orgDay.js';
import type { Prisma } from '@prisma/client';

export type DocScope = 'QT' | 'PI' | 'INV' | 'CN';

/**
 * The fiscal year label containing `date`, for an organisation whose year starts
 * in month `fiscalYearStart`.
 *
 *   April start,   15 Mar 2027  ->  '2026-27'   (still the old year)
 *   April start,   01 Apr 2027  ->  '2027-28'
 *   January start, 15 Mar 2027  ->  '2027'      (no span, so no hyphen)
 */
export const fiscalYearLabel = (
  date: Date,
  timeZone: string,
  fiscalYearStart: number,
): string => {
  const { year, month } = localParts(date, timeZone);

  if (fiscalYearStart === 1) return String(year);

  const startYear = month >= fiscalYearStart ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
};

/**
 * Allocate the next number for this organisation, scope and fiscal year.
 *
 * Pass `tx` when allocating inside a transaction — an invoice and its number must
 * be created together, or a failed insert burns a number and leaves a gap that
 * looks like a deleted document.
 */
export const generateDocumentNumber = async (
  organizationId: string,
  scope: DocScope,
  tx?: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> => {
  const config = await getOrgConfig(organizationId);
  const period = fiscalYearLabel(now, config.timezone, config.fiscalYearStart);
  const client = tx ?? prisma;

  const rows = await client.$queryRaw<{ counter: number }[]>`
    INSERT INTO "doc_counters" ("id", "organizationId", "scope", "period", "counter")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${scope}, ${period}, 1)
    ON CONFLICT ("organizationId", "scope", "period")
    DO UPDATE SET "counter" = "doc_counters"."counter" + 1
    RETURNING "counter";
  `;

  const sequence = String(rows[0].counter).padStart(3, '0');
  return `${config.documentPrefix}/${scope}/${period}/${sequence}`;
};

/**
 * What the next number *would* be, without consuming it.
 *
 * For previewing a number on a draft. Deliberately separate from allocation, and
 * never used to assign one: reading and then writing is exactly the race the
 * atomic statement above exists to avoid.
 */
export const peekDocumentNumber = async (
  organizationId: string,
  scope: DocScope,
  now: Date = new Date(),
): Promise<string> => {
  const config = await getOrgConfig(organizationId);
  const period = fiscalYearLabel(now, config.timezone, config.fiscalYearStart);

  const row = await prisma.docCounter.findUnique({
    where: { organizationId_scope_period: { organizationId, scope, period } },
    select: { counter: true },
  });

  const next = String((row?.counter ?? 0) + 1).padStart(3, '0');
  return `${config.documentPrefix}/${scope}/${period}/${next}`;
};
