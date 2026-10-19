import { hasPermission } from '../middleware/auth.js';
import type { UserSession } from '../middleware/auth.js';

/**
 * Who sees what a deal is worth (Founder, 19 Oct 2026).
 *
 * A proposal's quoted figure is the studio's price, and prices are
 * Management's. BD run the pipeline (`pipeline.read`) without `money.figures`,
 * and the client record already kept retainer fees, project values and
 * proforma amounts from them on that key. Deal values were the gap: the board,
 * the Proposals list and the client's Proposals tab all printed them.
 *
 * Same key, so a per-person grant on the Team screen still works.
 */
export const canSeeDealValues = (user: UserSession): boolean => hasPermission(user, 'money.figures');

type WithVersions = { versions?: { value?: unknown }[]; wonVersion?: { value?: unknown } | null };

/** A proposal with every quoted figure nulled — null, not 0, so "hidden" never reads as "₹0". */
export function maskDealValues<T extends WithVersions>(proposal: T, canSee: boolean): T {
  if (canSee) return proposal;
  return {
    ...proposal,
    ...(proposal.versions ? { versions: proposal.versions.map((v) => ({ ...v, value: null })) } : {}),
    ...(proposal.wonVersion ? { wonVersion: { ...proposal.wonVersion, value: null } } : {}),
  };
}
