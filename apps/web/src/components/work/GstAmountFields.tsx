'use client';

/**
 * What a bill said, and what actually left the account.
 *
 * A vendor's invoice reads "₹10,000 + 18% GST", and ₹11,800 is what goes out.
 * The cost forms asked for one number, so whoever typed it had to choose which
 * — and both choices were wrong in a different way. Type the base and the
 * month's cost is short by the tax. Type the gross and the rate is lost, so
 * nothing afterwards can separate the two again.
 *
 * So: the amount as printed on the bill, the rate beside it, and the total
 * said out loud underneath rather than worked out on a phone. What is STORED
 * is the total — every figure in the app reads `Cost.amount` and none of them
 * should start meaning something else — with the rate kept alongside so the
 * split stays recoverable.
 *
 * One component for all three cost forms, because three copies of a tax
 * calculation is three chances for them to disagree.
 */

import { formatMoney } from '@/lib/api-v2';
import { Field, FieldSelect } from '@/components/ui/field';

/** The rates that exist. "None" is not 0% — it is a bill with no tax on it. */
const GST_OPTIONS = [
  { value: '', label: 'No GST' },
  { value: '5', label: '5%' },
  { value: '12', label: '12%' },
  { value: '18', label: '18%' },
  { value: '28', label: '28%' },
];

/** Base and rate → what leaves the account. Rounded to the paisa, once. */
export const grossFromBase = (base: string, gst: string): number => {
  const b = Number(base) || 0;
  const g = Number(gst) || 0;
  return Math.round(b * (1 + g / 100) * 100) / 100;
};

/** And back, for a form opened on a cost that was saved earlier. */
export const baseFromGross = (gross: string | number | null, gst: number | null | undefined): string => {
  const total = Number(gross) || 0;
  const g = Number(gst) || 0;
  if (!total) return '';
  return String(Math.round((total / (1 + g / 100)) * 100) / 100);
};

export function GstAmountFields({
  amount,
  onAmountChange,
  gstPercent,
  onGstChange,
  disabled,
  label = 'Amount (₹)',
  mode = 'cost',
  required,
  hint,
}: {
  /** The figure on the bill, BEFORE tax. */
  amount: string;
  onAmountChange: (v: string) => void;
  gstPercent: string;
  onGstChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
  /**
   * Which side of the ledger this figure is on, because GST means opposite
   * things on each.
   *
   * `cost` — money going out. What left the account is the total, tax
   * included, and that is what gets recorded.
   *
   * `revenue` — a quote or a retainer fee. The GST charged on it was never the
   * studio's money: it is collected for the government and paid over. So the
   * figure recorded is the one BEFORE tax, and the total is shown only as
   * what the client will pay. Recording the total would inflate every margin
   * in the app by the rate.
   */
  mode?: 'cost' | 'revenue';
  /** Revenue is not always known yet — a quote can be logged unpriced. */
  required?: boolean;
  hint?: string;
}) {
  const gross = grossFromBase(amount, gstPercent);
  const hasGst = Number(gstPercent) > 0 && Number(amount) > 0;

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={label}
          value={amount}
          onChange={onAmountChange}
          type="number"
          required={required ?? mode === 'cost'}
          disabled={disabled}
          hint={hint ?? (mode === 'revenue' ? 'Before GST — what the work earns.' : 'Before tax, as printed on the bill.')}
        />
        <FieldSelect
          label="GST"
          value={gstPercent}
          onChange={onGstChange}
          options={GST_OPTIONS}
          disabled={disabled}
          placeholder="No GST"
        />
      </div>

      {/* Said out loud — and for the two sides it says different things,
          because the recorded figure is a different one. */}
      {hasGst && (
        <p className="rounded-xl border border-border bg-subtle/40 px-3 py-2 text-xs text-secondary">
          {formatMoney(Number(amount))} + {gstPercent}% GST ={' '}
          <span className="font-semibold text-primary">{formatMoney(gross)}</span>
          {mode === 'revenue'
            ? ` — what the client pays. ${formatMoney(Number(amount))} is the revenue; the GST is collected for the government.`
            : ' — this is what gets recorded.'}
        </p>
      )}
    </div>
  );
}
