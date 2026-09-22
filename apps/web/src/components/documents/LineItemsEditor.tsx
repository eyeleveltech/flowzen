'use client';

/**
 * CR-02 §5 — the items table, as it is filled in rather than as it prints.
 *
 * Six columns in the spec's order. Two of them are never typed:
 *
 *   Sr      is the row's position. Delete row 2 and row 3 becomes row 2, with
 *           no renumbering step, because there is no stored number to renumber.
 *   Amount  is units x unit cost, recalculated on every keystroke and shown
 *           read-only, so the figure on screen is the figure the server will
 *           store — it runs the same multiplication.
 *
 * Shared by the proforma form and the invoice document form. There is one
 * items table in this product, and this is it.
 */

import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LineItemDraft {
  particulars: string;
  units: string;
  unitCost: string;
  hsnSac: string;
}

export const blankLineItem = (): LineItemDraft => ({
  particulars: '',
  units: '1',
  unitCost: '',
  hsnSac: '',
});

/** What the row is worth. The single definition — the summary reads this too. */
export const lineAmount = (row: LineItemDraft): number => {
  const units = Number(row.units);
  const unitCost = Number(row.unitCost);
  if (!Number.isFinite(units) || !Number.isFinite(unitCost)) return 0;
  return Math.round(units * unitCost * 100) / 100;
};

export const linesSubtotal = (rows: LineItemDraft[]): number =>
  Math.round(rows.reduce((sum, row) => sum + lineAmount(row), 0) * 100) / 100;

/** A row is ready when it says what it is for and how much it is worth. */
export const isLineComplete = (row: LineItemDraft): boolean =>
  row.particulars.trim().length > 0 && Number(row.units) > 0 && Number(row.unitCost) >= 0 && row.unitCost.trim() !== '';

export const linesAreValid = (rows: LineItemDraft[]): boolean =>
  rows.length > 0 && rows.every(isLineComplete);

export const toLineItemPayload = (rows: LineItemDraft[]) =>
  rows.map((row) => ({
    particulars: row.particulars.trim(),
    units: Number(row.units),
    unitCost: Number(row.unitCost),
    hsnSac: row.hsnSac.trim() || null,
  }));

export const money = (amount: number): string =>
  '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cell =
  'w-full rounded-lg border border-border bg-white px-2.5 py-2 text-sm text-body outline-none transition-colors duration-150 motion-reduce:transition-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25';

type Props = {
  rows: LineItemDraft[];
  onChange: (rows: LineItemDraft[]) => void;
  /** The saved codes from Settings, offered as a datalist so one can be picked or a new one typed. */
  sacCodes?: string[];
  disabled?: boolean;
};

export function LineItemsEditor({ rows, onChange, sacCodes = [], disabled = false }: Props) {
  const sacListId = useId();

  const set = (index: number, key: keyof LineItemDraft, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const add = () => onChange([...rows, blankLineItem()]);

  // The last row is never removable: a document with no lines is not a shorter
  // document, it is one that cannot be saved, and a table with no rows gives
  // nowhere to start typing again.
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  const subtotal = linesSubtotal(rows);


  /*
   * A grid rather than a <table>.
   *
   * This looks like the items table because it becomes one, but it is a row of
   * form controls — and the app's table density rule (design.test.ts) exists so
   * that every DATA table agrees on a 33px row. Putting a text input inside a
   * 10px-padded cell either breaks that rule or gives the form a row height
   * chosen for reading rather than typing. The custom-fields editor next to it
   * is laid out the same way, for the same reason.
   */
  const grid = 'grid grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_6.5rem_5.75rem_6.5rem_1.75rem] items-center gap-2';

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[600px] space-y-1.5">
          <div className={grid} aria-hidden="true">
            <span className="eyebrow">Sr</span>
            <span className="eyebrow">Particulars</span>
            <span className="eyebrow text-right">Units</span>
            <span className="eyebrow text-right">Unit cost</span>
            <span className="eyebrow">HSN/SAC</span>
            <span className="eyebrow text-right">Amount</span>
            <span />
          </div>

          {rows.map((row, index) => (
            <div key={index} className={grid}>
              <span className="text-sm tabular-nums text-secondary">{index + 1}</span>
              <input
                className={cell}
                value={row.particulars}
                onChange={(e) => set(index, 'particulars', e.target.value)}
                placeholder="What this line is for"
                disabled={disabled}
                aria-label={`Particulars, line ${index + 1}`}
              />
              <input
                className={`${cell} text-right tabular-nums`}
                value={row.units}
                onChange={(e) => set(index, 'units', e.target.value)}
                type="number"
                step="0.001"
                min="0"
                disabled={disabled}
                aria-label={`Units, line ${index + 1}`}
              />
              <input
                className={`${cell} text-right tabular-nums`}
                value={row.unitCost}
                onChange={(e) => set(index, 'unitCost', e.target.value)}
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                disabled={disabled}
                aria-label={`Unit cost, line ${index + 1}`}
              />
              <input
                className={cell}
                value={row.hsnSac}
                onChange={(e) => set(index, 'hsnSac', e.target.value)}
                list={sacCodes.length > 0 ? sacListId : undefined}
                placeholder="998365"
                disabled={disabled}
                aria-label={`HSN or SAC code, line ${index + 1}`}
              />
              <span className="text-right text-sm tabular-nums text-body">{money(lineAmount(row))}</span>
              {rows.length > 1 && !disabled ? (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="p-1.5 text-secondary transition-colors hover:text-danger"
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </div>

      {sacCodes.length > 0 && (
        <datalist id={sacListId}>
          {sacCodes.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          Add a line
        </Button>
        <div className="text-sm text-secondary">
          Subtotal <span className="ml-2 font-semibold tabular-nums text-body">{money(subtotal)}</span>
        </div>
      </div>
    </div>
  );
}
