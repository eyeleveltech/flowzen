import { describe, it, expect } from 'vitest';
import { computeDocumentTotals } from './documentTotals.js';

/**
 * CR-02 §5 and §6 — the arithmetic a proforma and a tax invoice both print.
 *
 * The things worth pinning down here are not "does multiplication work". They
 * are the four places a document can quietly stop adding up: a serial number
 * that survives a deletion, a line amount rounded once too late, a CGST/SGST
 * split whose halves do not sum to the tax, and a total that is not the
 * subtotal plus the tax plus the round off.
 */

const line = (particulars: string, units: number, unitCost: number, hsnSac?: string) => ({
  particulars,
  units,
  unitCost,
  hsnSac,
});

const opts = (over: Partial<{ gstApplicable: boolean; gstRatePercent: number; isInterState: boolean }> = {}) => ({
  gstApplicable: true,
  gstRatePercent: 18,
  isInterState: false,
  ...over,
});

describe('line items', () => {
  it('numbers rows from their position, so deleting one renumbers the rest', () => {
    // What the form sends after the middle row was removed: two rows, no gap.
    const result = computeDocumentTotals([line('First', 1, 100), line('Third', 1, 300)], opts());
    expect(result.lines.map((l) => l.serialNo)).toEqual([1, 2]);
    expect(result.lines.map((l) => l.particulars)).toEqual(['First', 'Third']);
  });

  it('computes each amount as units times unit cost', () => {
    const result = computeDocumentTotals([line('Reels', 3, 8500), line('Half day', 0.5, 20000)], opts());
    expect(result.lines[0].amount).toBe(25500);
    expect(result.lines[1].amount).toBe(10000);
    expect(result.subtotal).toBe(35500);
  });

  it('rounds each line before summing, so the printed column adds up to the printed subtotal', () => {
    // Three rows that each land on a third of a paisa. Summed raw and rounded
    // once at the end, the subtotal is 100.00 while the three printed amounts
    // read 33.33 and total 99.99 — a client's first question.
    const result = computeDocumentTotals(
      [line('A', 1, 33.333), line('B', 1, 33.333), line('C', 1, 33.334)],
      opts({ gstApplicable: false }),
    );
    const printed = result.lines.reduce((sum, l) => sum + l.amount, 0);
    expect(result.subtotal).toBe(Math.round(printed * 100) / 100);
  });

  it('trims the description and drops an empty code rather than printing a blank one', () => {
    const result = computeDocumentTotals([{ particulars: '  Retainer  ', units: 1, unitCost: 100, hsnSac: '  ' }], opts());
    expect(result.lines[0].particulars).toBe('Retainer');
    expect(result.lines[0].hsnSac).toBeNull();
  });

  it('falls back to the document rate when a line does not carry its own', () => {
    const result = computeDocumentTotals([line('Retainer', 1, 100)], opts({ gstRatePercent: 12 }));
    expect(result.lines[0].gstRate).toBe(12);
  });
});

describe('the GST split', () => {
  it('halves the tax for a supply inside the seller state', () => {
    const result = computeDocumentTotals([line('Retainer', 1, 100000)], opts());
    expect(result.cgstAmount).toBe(9000);
    expect(result.sgstAmount).toBe(9000);
    expect(result.igstAmount).toBe(0);
    expect(result.total).toBe(118000);
  });

  it('charges the whole rate as IGST across a state line', () => {
    const result = computeDocumentTotals([line('Retainer', 1, 100000)], opts({ isInterState: true }));
    expect(result.igstAmount).toBe(18000);
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.total).toBe(118000);
  });

  it('keeps the two halves summing to the tax when the tax is an odd number of paise', () => {
    // 555.61 at 18% is 100.0098 -> 100.01, whose half is not a whole paisa.
    // Rounding both halves gives 50.01 + 50.01 = 100.02, and the document then
    // says one thing in its tax rows and another in its total.
    const result = computeDocumentTotals([line('Odd', 1, 555.61)], opts());
    expect(result.cgstAmount + result.sgstAmount).toBeCloseTo(result.totalTax, 2);
  });

  it('charges nothing at all when GST does not apply, rather than a zero-rate line', () => {
    const result = computeDocumentTotals([line('Export', 1, 50000)], opts({ gstApplicable: false }));
    expect(result.totalTax).toBe(0);
    expect(result.cgstAmount).toBe(0);
    expect(result.igstAmount).toBe(0);
    expect(result.total).toBe(50000);
  });
});

describe('round off and total', () => {
  it('rounds the total to the whole rupee and records what that cost', () => {
    // The exact figures matter less than the identity: whatever the tax lands
    // on, subtotal + tax + round off is the total, to the paisa.
    const result = computeDocumentTotals([line('Retainer', 1, 12345.67)], opts());
    expect(Number.isInteger(result.total)).toBe(true);
    expect(result.subtotal + result.totalTax + result.roundOff).toBeCloseTo(result.total, 2);
  });

  it('rounds down as readily as up — the round off is signed', () => {
    // A subtotal whose taxed value lands just above a rupee gives a negative
    // round off. A document that only ever rounds up does not balance.
    const up = computeDocumentTotals([line('A', 1, 100.9)], opts({ gstApplicable: false }));
    const down = computeDocumentTotals([line('A', 1, 100.1)], opts({ gstApplicable: false }));
    expect(up.roundOff).toBeCloseTo(0.1, 2);
    expect(down.roundOff).toBeCloseTo(-0.1, 2);
    expect(up.total).toBe(101);
    expect(down.total).toBe(100);
  });

  it('says the total in words, from the rounded figure', () => {
    const result = computeDocumentTotals([line('Retainer', 1, 30000)], opts());
    expect(result.total).toBe(35400);
    expect(result.amountInWords).toBe('Rupees Thirty Five Thousand Four Hundred Only.');
  });

  it('never lets the words disagree with the total after rounding', () => {
    const result = computeDocumentTotals([line('Odd', 1, 12345.67)], opts());
    expect(result.amountInWords).toContain('Only.');
    expect(result.amountInWords).not.toContain('Paise');
  });
});
