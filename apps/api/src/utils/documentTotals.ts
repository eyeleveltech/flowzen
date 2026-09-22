/**
 * CR-02 §5 and §6 — what a document's own arithmetic is.
 *
 * Everything a printed proforma or invoice claims below the items table is
 * computed here and nowhere else: the line amounts, the subtotal, the GST
 * split, the round off, the total, and the words. Two documents, one set of
 * sums, so a proforma and the invoice that follows it can never disagree.
 *
 * The result of this function is what gets STORED on the document, not
 * recomputed at print time. That is the whole point of §9: a rate change, a
 * new rounding rule or a corrected GSTIN must not silently restate a figure a
 * client has already been sent.
 */

import { calculateGst } from './tax.js';
import { amountInWords } from './amountInWords.js';

/** One row as the form sends it. `serialNo` is deliberately absent — see below. */
export interface LineItemInput {
  particulars: string;
  units: number;
  unitCost: number;
  hsnSac?: string | null;
  gstRate?: number | null;
}

/** One row as it is stored and printed. */
export interface ComputedLineItem {
  serialNo: number;
  particulars: string;
  units: number;
  unitCost: number;
  hsnSac: string | null;
  amount: number;
  gstRate: number;
}

export interface DocumentTotals {
  lines: ComputedLineItem[];
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  /** Signed. As often negative as positive; a document that only rounds up does not balance. */
  roundOff: number;
  total: number;
  amountInWords: string;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface DocumentTotalsOptions {
  gstApplicable: boolean;
  gstRatePercent: number;
  /** Decided by place of supply against the seller's state — never by the buyer's GSTIN. */
  isInterState: boolean;
}

export function computeDocumentTotals(
  items: LineItemInput[],
  { gstApplicable, gstRatePercent, isInterState }: DocumentTotalsOptions,
): DocumentTotals {
  // §5: "Sr — auto generated ... renumbers automatically if a row is deleted or
  // reordered. Never entered by hand." Array position is the order the user put
  // the rows in, so it is the only thing the number can honestly come from.
  const lines: ComputedLineItem[] = items.map((item, index) => {
    const units = Number(item.units) || 0;
    const unitCost = Number(item.unitCost) || 0;
    return {
      serialNo: index + 1,
      particulars: item.particulars.trim(),
      units,
      unitCost,
      hsnSac: item.hsnSac?.trim() || null,
      // Rounded per row, not once at the end. Six rows each carrying a third of
      // a paisa would otherwise make the printed column not add up to the
      // printed subtotal, which is the first thing a client checks.
      amount: round2(units * unitCost),
      gstRate: item.gstRate ?? gstRatePercent,
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));

  const gst = gstApplicable
    ? calculateGst(subtotal, isInterState, gstRatePercent)
    : { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalTaxAmount: 0 };

  // §6: "Round off = difference to the nearest whole rupee. TOTAL = subtotal +
  // tax + round off." Computed in that order — the total is the rounded figure
  // and the round off is whatever it took to get there, so the column always
  // adds up downward even when the tax lands on a half paisa.
  const beforeRounding = round2(subtotal + gst.totalTaxAmount);
  const total = Math.round(beforeRounding);
  const roundOff = round2(total - beforeRounding);

  return {
    lines,
    subtotal,
    cgstAmount: gst.cgstAmount,
    sgstAmount: gst.sgstAmount,
    igstAmount: gst.igstAmount,
    totalTax: gst.totalTaxAmount,
    roundOff,
    total,
    amountInWords: amountInWords(total),
  };
}
