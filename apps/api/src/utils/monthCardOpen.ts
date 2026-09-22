import { MonthCardStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * A closed month is a reported month.
 *
 * Closing a month card is what fixes its profit figure: the fee is settled,
 * the costs are in, and somebody has looked at the margin and acted on it.
 * Nothing about that was enforced — `checkWorkLinks` in costs.ts selected
 * `{ id: true }` and never read the status, and the task routes never looked
 * at the card at all — so a cost entered in September against August silently
 * rewrote a number that had already been reported, with no trace on the screen
 * that showed it.
 *
 * This is the one place that answers "may I still write to this month?", so
 * the costs routes and the task routes cannot drift apart on it.
 *
 * Reopening is deliberately a separate, deliberate act (POST
 * /retainers/:id/month-cards/:month/reopen) rather than something that happens
 * by accident on the way to entering a cost.
 */
export async function monthCardRefusal(
  monthCardId: string | null | undefined,
  what: string,
): Promise<string | null> {
  if (!monthCardId) return null;
  const card = await prisma.monthCard.findUnique({
    where: { id: monthCardId },
    select: { status: true, month: true },
  });
  // A card that is not there is somebody else's problem — the callers already
  // 400 on an unknown id, and answering here too would only confuse the message.
  if (!card || card.status !== MonthCardStatus.CLOSED) return null;
  return `${monthName(card.month)} is closed. ${what} would change a month whose profit has already been reported — reopen the month first if it really needs to change.`;
}

/** "2026-08" → "August 2026", because a refusal should name the month a person sees. */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
