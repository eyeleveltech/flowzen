/**
 * What an invoice means, in one place.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * The Money screen answered the same question four different ways and got four
 * different answers, all on screen at once:
 *
 *   Outstanding ₹4,15,500   summed `balanceDue` over EVERY row — a cancelled
 *                           invoice and an invoice already settled both counted
 *                           as money somebody owes. The true figure was
 *                           ₹2,80,000.
 *   0 pending               filtered on `PENDING` and `PARTIAL`, neither of
 *                           which is in `InvoiceStatus` — so the number could
 *                           only ever be zero.
 *   Overdue 0               read `isOverdue`, which the API computed and never
 *                           sent, beside rows plainly marked OVERDUE.
 *   the rows                read the API's derived `status`, and were right.
 *
 * None of those four is a hard problem. The problem was that each was written
 * where it was needed, so nothing forced them to agree. These functions are the
 * only place the question gets answered now.
 *
 * ─── The vocabulary ─────────────────────────────────────────────────────────
 *
 * `InvoiceStatus` is RAISED | PAID | OVERDUE | CANCELLED, and the list route
 * derives RAISED into OVERDUE once the due date has passed. There is no
 * PENDING and no PARTIAL — a part-paid invoice is a RAISED one with a
 * `balanceDue` smaller than its `amount`.
 */

export interface InvoiceLike {
  status: string;
  /** Null when the reader lacks `money.figures` — never 0. See `sumOutstanding`. */
  balanceDue: number | null;
  isOverdue?: boolean;
}

/**
 * Is this invoice money somebody still owes?
 *
 * Cancelled work was never billed and settled work is already in the bank;
 * neither is a receivable, whatever `balanceDue` arithmetic says about them.
 */
export const isCollectible = (i: InvoiceLike) => i.status !== 'PAID' && i.status !== 'CANCELLED';

/** Past its due date and still owed. */
export const isOverdue = (i: InvoiceLike) => isCollectible(i) && (i.isOverdue === true || i.status === 'OVERDUE');

/** Owed, and not late yet — the half of Outstanding that is simply waiting. */
export const isAwaiting = (i: InvoiceLike) => isCollectible(i) && !isOverdue(i);

/** What one invoice contributes to Outstanding. */
export const outstandingOf = (i: InvoiceLike) => (isCollectible(i) ? (i.balanceDue ?? 0) : 0);

/**
 * Outstanding across a list — or `null` when the figures are masked.
 *
 * A reader without `money.figures` gets `balanceDue: null` on every row, and
 * `null ?? 0` would total that to a confident ₹0. Masked money is not zero
 * money, and a screen that says ₹0 to somebody who simply is not allowed to
 * see the number is worse than one that says nothing.
 */
export function sumOutstanding(invoices: InvoiceLike[]): number | null {
  if (invoices.length > 0 && invoices.every((i) => i.balanceDue === null)) return null;
  return invoices.reduce((sum, i) => sum + outstandingOf(i), 0);
}
