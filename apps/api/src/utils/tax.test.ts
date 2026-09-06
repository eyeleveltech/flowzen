/**
 * GST, and the one property a tax document must have: it adds up.
 *
 * Worth testing at the paisa because that is exactly where it went wrong — the
 * common round numbers an agency quotes (₹1,00,000 at 18%) split evenly and hid
 * the bug, while anything with an odd number of paise in its tax printed two
 * halves that summed to more than the whole.
 */

import { describe, it, expect } from 'vitest';
import { calculateGst } from './tax.js';

/** Money compared as paisa integers — 0.1 + 0.2 is not 0.3 in binary floats. */
const paise = (n: number) => Math.round(n * 100);

describe('calculateGst', () => {
  it('splits a round amount evenly, as it always did', () => {
    const r = calculateGst(100000, false, 18);
    expect(r.cgstAmount).toBe(9000);
    expect(r.sgstAmount).toBe(9000);
    expect(r.igstAmount).toBe(0);
    expect(r.totalTaxAmount).toBe(18000);
    expect(r.totalAmountWithTax).toBe(118000);
  });

  it('puts the whole tax on IGST for an inter-state sale', () => {
    const r = calculateGst(100000, true, 18);
    expect(r.igstAmount).toBe(18000);
    expect(r.cgstAmount).toBe(0);
    expect(r.sgstAmount).toBe(0);
    expect(r.isInterState).toBe(true);
  });

  it('never lets the two halves out-total the tax they are halves of', () => {
    // The regression. ₹555.61 at 18% is ₹100.01 of tax; rounding each half
    // independently made both 50.01, summing to 100.02.
    const r = calculateGst(555.61, false, 18);
    expect(paise(r.cgstAmount) + paise(r.sgstAmount)).toBe(paise(r.totalTaxAmount));
  });

  it('adds up at every paisa across a wide range of amounts', () => {
    for (let base = 1; base <= 20000; base += 7) {
      const amount = base + 0.37; // drag the tax onto odd paise
      for (const rate of [5, 12, 18, 28]) {
        const r = calculateGst(amount, false, rate);
        expect(paise(r.cgstAmount) + paise(r.sgstAmount)).toBe(paise(r.totalTaxAmount));
        expect(paise(r.baseAmount) + paise(r.totalTaxAmount)).toBe(paise(r.totalAmountWithTax));
      }
    }
  });

  it('keeps the halves within a paisa of each other', () => {
    // The remainder lands on one side; it must never be more than that.
    const r = calculateGst(555.61, false, 18);
    expect(Math.abs(paise(r.cgstAmount) - paise(r.sgstAmount))).toBeLessThanOrEqual(1);
  });

  it('treats a negative or unusable amount as nothing to tax', () => {
    for (const bad of [-500, NaN, undefined as unknown as number]) {
      const r = calculateGst(bad, false, 18);
      expect(r.baseAmount).toBe(0);
      expect(r.totalTaxAmount).toBe(0);
      expect(r.totalAmountWithTax).toBe(0);
    }
  });

  it('charges nothing at a zero rate, without inventing a tax row', () => {
    const r = calculateGst(50000, false, 0);
    expect(r.totalTaxAmount).toBe(0);
    expect(r.cgstAmount).toBe(0);
    expect(r.sgstAmount).toBe(0);
    expect(r.totalAmountWithTax).toBe(50000);
  });
});
