'use client';

/**
 * The two smaller pieces of CR-02 §4, and the totals preview that reassures
 * somebody the figure they are about to send is the one they meant.
 *
 * Both the proforma form and the invoice document form use all three, which is
 * the point: one shape of document, filled in one way.
 */

import { Plus, Trash2 } from 'lucide-react';
import { GST_STATES } from '@flowzen/shared';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field';
import { lineAmount, lineRate, money, type LineItemDraft } from './LineItemsEditor';

/**
 * The document's tax as the server will work it out: each line at its own
 * rate, grouped by rate and rounded once per rate (utils/documentTotals.ts,
 * `taxByRate`). One rate gives exactly the old single-rate figure.
 */
export function previewTotals(lines: LineItemDraft[], gstApplicable: boolean, documentRate: number) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const byRate = new Map<number, number>();
  for (const line of lines) {
    const rate = lineRate(line, documentRate);
    byRate.set(rate, (byRate.get(rate) ?? 0) + lineAmount(line));
  }
  const rates = gstApplicable
    ? [...byRate].map(([rate, sum]) => {
        const taxable = round2(sum);
        const tax = round2((taxable * rate) / 100);
        const cgst = round2(tax / 2);
        return { rate, taxable, tax, cgst, sgst: round2(tax - cgst) };
      })
    : [];
  const subtotal = round2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const tax = round2(rates.reduce((s, r) => s + r.tax, 0));
  const beforeRounding = round2(subtotal + tax);
  const total = Math.round(beforeRounding);
  return { subtotal, rates, tax, total, roundOff: round2(total - beforeRounding) };
}

// ── Place of supply ─────────────────────────────────────────────────────────

/**
 * The state list, labelled the way the document prints it.
 *
 * This read "Tamil Nadu (33)" while the printed proforma and invoice now read
 * "Tamil Nadu", so the form and the document disagreed on screen about the
 * same field. The code is still the value — it is what decides CGST+SGST
 * against IGST — it just stopped being shown, because a person picking their
 * client's state is picking a place, not a number.
 */
export const STATE_OPTIONS = GST_STATES.map((s) => ({ value: s.code, label: s.name }));

/**
 * §4 — "must be its own field and must not be auto-filled without being
 * editable". So: it is pre-filled from the buyer's state, and it is a control
 * the user can change, and the hint says which state the tax will be worked
 * out against rather than leaving them to infer it from a two-digit code.
 */
export function PlaceOfSupplyField({
  value,
  onChange,
  sellerStateCode,
  disabled,
  label = 'Place of supply',
}: {
  value: string;
  onChange: (code: string) => void;
  sellerStateCode?: string | null;
  disabled?: boolean;
  label?: string;
}) {
  const interState = Boolean(value && sellerStateCode && value !== sellerStateCode);
  const hint = !value
    ? 'Defaults to the client’s state. This is what decides the tax, so change it if the supply happens elsewhere.'
    : interState
      ? 'Outside your own state, so the tax is IGST.'
      // Says how the tax is worked out, not what the page prints. A proforma
      // shows the two halves added up as one GST line, so "this document
      // charges CGST and SGST" read as a contradiction of the row above it.
      : 'Your own state, so the tax is CGST + SGST rather than IGST.';

  return (
    <div>
      <FieldSelect
        label={label}
        value={value}
        onChange={onChange}
        options={STATE_OPTIONS}
        placeholder="Choose a state…"
        disabled={disabled}
      />
      <p className="mt-1 text-micro text-secondary">{hint}</p>
    </div>
  );
}

// ── Custom fields ───────────────────────────────────────────────────────────

export interface CustomFieldDraft {
  label: string;
  value: string;
}

const cell =
  'w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm text-body outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25';

/**
 * §4's open list. Rows left blank are dropped on save rather than refused —
 * clicking "Add a field" and changing your mind is not an error.
 */
export function CustomFieldsEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: CustomFieldDraft[];
  onChange: (rows: CustomFieldDraft[]) => void;
  disabled?: boolean;
}) {
  const set = (index: number, key: keyof CustomFieldDraft, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className={`${cell} w-40 shrink-0`}
            value={row.label}
            onChange={(e) => set(index, 'label', e.target.value)}
            placeholder="Reference"
            disabled={disabled}
            aria-label={`Custom field label ${index + 1}`}
          />
          <input
            className={cell}
            value={row.value}
            onChange={(e) => set(index, 'value', e.target.value)}
            placeholder="What it says on the document"
            disabled={disabled}
            aria-label={`Custom field value ${index + 1}`}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              className="shrink-0 p-1.5 text-secondary transition-colors hover:text-danger"
              aria-label={`Remove custom field ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...rows, { label: '', value: '' }])}
        disabled={disabled}
      >
        <Plus className="h-3.5 w-3.5" />
        Add a field
      </Button>
    </div>
  );
}

export const toCustomFieldPayload = (rows: CustomFieldDraft[]) =>
  rows
    .map((row) => ({ label: row.label.trim(), value: row.value.trim() }))
    .filter((row) => row.label || row.value);

// ── Totals preview ──────────────────────────────────────────────────────────

/**
 * The same arithmetic the server does, shown before the save.
 *
 * It is a preview, not the source of truth — the stored figures are whatever
 * `utils/documentTotals.ts` computes — but a form that asks for a subtotal and
 * a tax rate and then shows neither the tax nor the total makes people open a
 * calculator to check a document they are about to send a client.
 */
export function TotalsPreview({
  subtotal,
  gstApplicable,
  gstRatePercent,
  interState,
  kind,
  lines,
}: {
  subtotal: number;
  gstApplicable: boolean;
  gstRatePercent: number;
  interState: boolean;
  /** The lines, so each is taxed at its own rate. Without them: one rate on the subtotal. */
  lines?: LineItemDraft[];
  /**
   * Which document this is going to be. Required rather than defaulted: the
   * two kinds genuinely print the tax differently, and a preview that guessed
   * would be wrong half the time without anyone noticing.
   */
  kind: 'PROFORMA' | 'INVOICE';
}) {
  const sums = previewTotals(
    lines ?? [{ particulars: '', units: '1', unitCost: String(subtotal), hsnSac: '', gstRate: '' }],
    gstApplicable,
    gstRatePercent,
  );
  const { total, roundOff } = sums;

  const row = (label: string, amount: number, strong = false) => (
    <div className={`flex justify-between py-1 text-sm ${strong ? 'font-semibold text-body' : 'text-secondary'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-subtle px-3.5 py-2">
      {row('Subtotal', subtotal)}
      {/*
        A proforma prints one GST line and a tax invoice prints the heads
        separately — Rule 46(m) requires the breakup on an invoice, and a
        proforma has no statutory format. The preview follows the document it
        is previewing, so what is on screen is what the client will receive.
      */}
      {/* A row per rate, as the document prints them. No zero rows (§6). */}
      {sums.rates.map((r) => (
        <div key={r.rate}>
          {kind === 'PROFORMA' && r.tax !== 0 && row(`GST @ ${r.rate}%`, r.tax)}
          {kind === 'INVOICE' && interState && r.tax !== 0 && row(`IGST @ ${r.rate}%`, r.tax)}
          {kind === 'INVOICE' && !interState && r.cgst !== 0 && row(`CGST @ ${r.rate / 2}%`, r.cgst)}
          {kind === 'INVOICE' && !interState && r.sgst !== 0 && row(`SGST @ ${r.rate / 2}%`, r.sgst)}
        </div>
      ))}
      {!gstApplicable && (
        <div className="flex justify-between py-1 text-sm text-secondary">
          <span>GST</span>
          <span>Not applicable</span>
        </div>
      )}
      {roundOff !== 0 && row('Round off', roundOff)}
      <div className="mt-1 border-t border-border pt-1">{row('Total', total, true)}</div>
    </div>
  );
}
