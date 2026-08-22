/**
 * The one place a company's status is decided.
 *
 * `Company.status` is STORED rather than derived (master plan §3.2), and that is
 * only safe under a hard constraint: **exactly one function writes it.** Every
 * path that could change it — winning a deal, an engagement ending, a pause, an
 * import — calls `syncCompanyStatus`, which reads the engagements and works out
 * the answer.
 *
 * "Dashboard says 1, list says 5" was never caused by storing a value. It was
 * caused by several places each deciding it independently. Nothing outside this
 * file may assign to `status`.
 */

import type { CompanyStatus, ContractType, EngagementStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type EngagementSummary = {
  status: EngagementStatus;
  type: ContractType;
  /** When it actually stopped. Null while it is still running. */
  endedAt: Date | null;
  /** The agreed end date. Null on a rolling retainer. */
  endDate: Date | null;
};

/**
 * Work out what a company's status should be from its engagements alone.
 *
 * Pure, so the rule can be tested exhaustively without a database — and so the
 * rule is readable in one place rather than spread across the callers.
 */
export const deriveCompanyStatus = (engagements: EngagementSummary[]): CompanyStatus => {
  // Never bought anything. Not a customer, and the word means what it says here
  // because Company is one table for both — unlike the old ClientStatus, where
  // "prospect client" was a contradiction.
  if (engagements.length === 0) return 'PROSPECT';

  // Anything running at all makes them a customer, even if other work has ended.
  if (engagements.some((e) => e.status === 'ACTIVE')) return 'ACTIVE';

  // Nothing running, but something is paused — deliberately, by someone. Pausing
  // a customer stops real money, so it is an explicit act and deserves its own
  // state rather than being filed as churn (§4.11).
  if (engagements.some((e) => e.status === 'PAUSED')) return 'ONHOLD';

  // Everything has ended. WHICH ended last decides how this reads, and the
  // distinction matters more than it looks: an agency delivering twenty websites
  // a year would otherwise show twenty churned clients during its best year, and
  // the churn figure becomes one nobody can use.
  //
  // Churn measures lost RECURRING revenue. A project ending loses nothing
  // recurring, because there was nothing recurring.
  const last = [...engagements].sort(
    (a, b) => endInstant(b) - endInstant(a),
  )[0];

  return last.type === 'PROJECT' ? 'PROJECT_COMPLETED' : 'CHURNED';
};

/**
 * When an engagement stopped, for ordering.
 *
 * `endedAt` is when it actually stopped and `endDate` is when it was meant to.
 * They differ when a client leaves early or runs on past the term, and the real
 * one is what happened. Falling back to 0 keeps an engagement with neither at the
 * bottom rather than the top, so a record with missing dates cannot silently
 * decide the company's status.
 */
const endInstant = (e: EngagementSummary): number =>
  e.endedAt?.getTime() ?? e.endDate?.getTime() ?? 0;

/**
 * Recalculate and persist a company's status.
 *
 * Returns the status it settled on, and whether it changed — callers use the
 * second to decide whether to write an activity or an audit entry, since a status
 * change is one of the four audited events (§3.12).
 *
 * Pass `tx` when this is part of a larger action. Winning a deal creates an
 * engagement AND moves the company to ACTIVE, and those must not be separable:
 * one click cannot half-win a deal.
 */
export const syncCompanyStatus = async (
  companyId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ status: CompanyStatus; changed: boolean; previous: CompanyStatus }> => {
  const client = tx ?? prisma;

  const company = await client.company.findUnique({
    where: { id: companyId },
    select: { id: true, status: true },
  });
  if (!company) throw new Error(`Company ${companyId} not found`);

  const engagements = await client.engagement.findMany({
    where: { companyId },
    select: { status: true, type: true, endedAt: true, endDate: true },
  });

  const status = deriveCompanyStatus(engagements);

  if (status === company.status) {
    return { status, changed: false, previous: company.status };
  }

  await client.company.update({ where: { id: companyId }, data: { status } });

  return { status, changed: true, previous: company.status };
};

/**
 * Human-readable explanation of a status, for the company page.
 *
 * Each status has to imply a DIFFERENT next action, or it is decoration rather
 * than information. Writing the actions down is how that stays true.
 */
export const statusMeaning = (
  status: CompanyStatus,
): { label: string; nextAction: string } => {
  switch (status) {
    case 'PROSPECT':
      return { label: 'Prospect', nextAction: 'Sell to them' };
    case 'ACTIVE':
      return { label: 'Active client', nextAction: 'Deliver, and review the price every 6 months' };
    case 'ONHOLD':
      return { label: 'On hold', nextAction: 'Find out when they are coming back' };
    case 'PROJECT_COMPLETED':
      return {
        label: 'Project completed',
        nextAction: 'Check in — a client who just had a good experience is the easiest sale you have',
      };
    case 'CHURNED':
      return { label: 'Churned', nextAction: 'Find out what went wrong' };
  }
};
