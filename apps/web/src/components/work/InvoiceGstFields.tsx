'use client';

/**
 * GST on an invoice entered from Tally, and on a payment against one.
 *
 * Ticked, the amount above it is the amount BEFORE GST, the GST is its own
 * figure (filled in at the rate, and changeable to match Tally to the paisa),
 * and what is saved as the amount is the two added together — for an invoice
 * the payable total, which payments are settled against; for a payment what
 * was received, which settles it. Unticked, the amount is the whole figure,
 * as it always was.
 *
 * Used by every form that records a Tally invoice (Money → Record an invoice,
 * a retainer month's Enter invoice, a project milestone's) and every form that
 * records a payment (Record payment, a milestone's payment step).
 */

import { useState } from 'react';
import { Field, FieldCheckbox } from '@/components/ui/field';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rupees, with the paise when there are any. The app's money format rounds to
 * whole rupees, which is right for a dashboard and wrong here: a GST of
 * ₹17,999.50 has to show a total that ends in .50, or the figure on screen is
 * not the figure saved.
 */
const exact = (n: number) =>
  n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export type InvoiceGst = ReturnType<typeof useInvoiceGst>;

export function useInvoiceGst(
  baseText: string,
  opts: {
    /** Start ticked — a retainer that charges GST, a proforma or invoice that did. */
    defaultOn?: boolean;
    /** The rate the GST is filled in at. 18% when not given. */
    ratePercent?: number | null;
    /**
     * An exact GST to start from — the proforma's own, or a payment's share
     * of its invoice's. Shown while the amount is still the one it came with;
     * change the amount and the GST follows it at the rate.
     */
    defaultGst?: number | null;
  } = {},
) {
  const rate = opts.ratePercent && opts.ratePercent > 0 ? opts.ratePercent : 18;
  const [on, setOn] = useState(Boolean(opts.defaultOn));
  const [startBase] = useState(baseText);
  // Null until the person types their own; until then it follows the amount.
  const [typed, setTyped] = useState<string | null>(null);

  const base = Number(baseText) || 0;
  const atRate = round2((base * rate) / 100);
  const startGst = opts.defaultGst != null && opts.defaultGst > 0 && baseText === startBase ? opts.defaultGst : null;
  const gstText = typed ?? (startGst !== null ? String(startGst) : base > 0 ? String(atRate) : '');
  const gst = on ? Number(gstText) : 0;
  const gstValid = !on || (gstText.trim() !== '' && Number.isFinite(gst) && gst >= 0);

  return {
    on,
    setOn,
    /** "18%", or "17.5%" for an invoice whose GST was not a round rate. */
    rateLabel: `${round2(rate)}%`,
    atRate,
    gstText,
    setGstText: (v: string) => setTyped(v),
    /** Back to following the amount at the rate. */
    useRate: () => setTyped(null),
    edited: typed !== null && Number(typed) !== atRate,
    gstValid,
    /** What is saved as the amount: the total. */
    total: round2(base + (gstValid ? gst : 0)),
    /** For the API: the GST inside the total, or null when GST is not ticked. */
    gstAmount: on && gstValid ? round2(gst) : null,
  };
}

const WORDS = {
  invoice: {
    tick: 'Add GST',
    off: 'Tick when the Tally invoice charges GST.',
    total: 'Total payable',
  },
  payment: {
    tick: 'Separate the GST',
    off: 'Tick to record how much of this payment is GST.',
    total: 'Total received',
  },
} as const;

export function InvoiceGstFields({
  gst,
  disabled,
  kind = 'invoice',
}: {
  gst: InvoiceGst;
  disabled?: boolean;
  kind?: 'invoice' | 'payment';
}) {
  const words = WORDS[kind];
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <FieldCheckbox
        label={words.tick}
        checked={gst.on}
        onChange={gst.setOn}
        disabled={disabled}
        hint={gst.on ? 'The amount above is before GST.' : words.off}
      />
      {gst.on && (
        <>
          <Field
            label="GST amount (₹)"
            value={gst.gstText}
            onChange={gst.setGstText}
            type="number"
            required
            disabled={disabled}
            hint={
              gst.edited
                ? `${gst.rateLabel} would be ${exact(gst.atRate)}.`
                : kind === 'payment'
                  ? `${gst.rateLabel} of the amount — the invoice's own share. Change it if it differs.`
                  : `${gst.rateLabel} of the amount. Change it to match Tally if it differs.`
            }
          />
          {gst.edited && (
            <button
              type="button"
              onClick={gst.useRate}
              disabled={disabled}
              className="text-xs font-medium text-primary underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Use {gst.rateLabel}
            </button>
          )}
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm text-secondary">{words.total}</span>
            <span className="text-base font-semibold tabular-nums text-primary">{exact(gst.total)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Where a payment's form starts when its invoice carries GST: the balance
 * split in the invoice's own ratio, so the total received is exactly the
 * balance — a paisa short would leave the invoice unpaid.
 */
export function paymentGstStart(balance: number, invoice: { total?: number | null; gst?: number | null }) {
  const total = Number(invoice.total ?? 0);
  const gst = Number(invoice.gst ?? 0);
  if (!(total > 0 && gst > 0 && gst < total) || !(balance > 0)) {
    return { on: false, base: balance, gst: null as number | null, ratePercent: null as number | null };
  }
  const ratePercent = (gst / (total - gst)) * 100;
  const base = round2(balance / (1 + ratePercent / 100));
  return { on: true, base, gst: round2(balance - base), ratePercent };
}
