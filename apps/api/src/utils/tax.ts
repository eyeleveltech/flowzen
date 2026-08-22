/**
 * Indian GST split — CGST + SGST, or IGST.
 *
 * An invoice has two parties and the split depends on both of them:
 *
 *     seller state == buyer state   ->  CGST + SGST, half the rate each
 *     seller state != buyer state   ->  IGST, the whole rate
 *
 * This is computed, never chosen. Both states are known at the moment an invoice
 * is issued, so asking a person to pick is asking them to re-derive something the
 * system already knows — and to get it wrong occasionally (master plan §3.11).
 *
 * The result is then FROZEN onto the invoice with the rest of its totals, because
 * an issued document never changes even if the company later corrects its address.
 */

import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type TaxSplit = {
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  total: Decimal;
  /** Which rule applied. Worth storing on the document so it can be explained. */
  kind: 'INTRA_STATE' | 'INTER_STATE';
};

/** Thrown when the split cannot be determined rather than guessed. */
export class TaxConfigurationError extends Error {
  readonly code = 'TAX_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'TaxConfigurationError';
  }
}

/**
 * Compare two Indian state names.
 *
 * Deliberately forgiving about spelling, because these are typed by hand into two
 * different records and "Tamil Nadu" / "TAMILNADU" / "Tamil  Nadu" are the same
 * state. Getting this wrong charges the customer the wrong kind of tax.
 */
export const sameState = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return normalise(a) === normalise(b);
};

/** Money rounded to paise, half-up — the rounding a tax authority expects. */
const money = (d: Decimal): Decimal => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

/**
 * Split `taxableAmount` at `ratePercent` between the seller's and buyer's states.
 *
 * Throws rather than guessing when the seller's state is unknown: a GST invoice
 * is not valid without it, and defaulting to either rule silently issues invoices
 * with the wrong tax on them. Failing here surfaces as "set your state in
 * Settings", which is a fixable message.
 */
export const computeTaxSplit = (
  taxableAmount: Decimal | number | string,
  ratePercent: Decimal | number | string,
  sellerState: string | null | undefined,
  buyerState: string | null | undefined,
): TaxSplit => {
  const taxable = money(new D(taxableAmount));
  const rate = new D(ratePercent);

  if (taxable.isNegative()) {
    throw new TaxConfigurationError('Taxable amount cannot be negative.');
  }
  if (rate.isNegative()) {
    throw new TaxConfigurationError('Tax rate cannot be negative.');
  }

  if (!sellerState?.trim()) {
    throw new TaxConfigurationError(
      "Your organisation's state is not set. Add it in Settings — without it the system " +
        'cannot tell whether an invoice is CGST + SGST or IGST.',
    );
  }

  const zero = new D(0);

  // No rate means no tax, and no rule needs to be applied.
  if (rate.isZero()) {
    return { taxable, cgst: zero, sgst: zero, igst: zero, total: taxable, kind: 'INTRA_STATE' };
  }

  // A buyer with no state on record is treated as inter-state. That is the
  // conservative reading: IGST is what applies to anyone outside your state, and
  // it is the same total either way — only the split differs. Under-collecting is
  // not a risk here; mislabelling is, so the kind is recorded.
  const intraState = sameState(sellerState, buyerState);
  const taxAmount = money(taxable.mul(rate).div(100));

  if (intraState) {
    // Halve, then give any odd paisa to CGST so the two halves still sum exactly
    // to the total. Splitting and rounding each independently can drift by a
    // paisa, and an invoice off by a paisa is a dispute.
    const half = money(taxAmount.div(2));
    const other = taxAmount.sub(half);
    return {
      taxable,
      cgst: half,
      sgst: other,
      igst: zero,
      total: taxable.add(taxAmount),
      kind: 'INTRA_STATE',
    };
  }

  return {
    taxable,
    cgst: zero,
    sgst: zero,
    igst: taxAmount,
    total: taxable.add(taxAmount),
    kind: 'INTER_STATE',
  };
};
