import { describe, it, expect } from 'vitest';
import { paymentGstStart } from './InvoiceGstFields';

/**
 * Where a payment's form starts when its invoice carries GST: the balance,
 * split in the invoice's own ratio. The two halves must add up to the balance
 * to the paisa — a paisa short and a full payment leaves the invoice unpaid.
 */
describe('paymentGstStart', () => {
  it('splits a full balance at the invoice\u2019s 18%', () => {
    expect(paymentGstStart(118000, { total: 118000, gst: 18000 })).toEqual({ on: true, base: 100000, gst: 18000, ratePercent: 18 });
  });

  it('adds back up to the balance exactly, for awkward figures too', () => {
    for (const balance of [59000.5, 33333.33, 1, 117999.99, 250]) {
      const s = paymentGstStart(balance, { total: 117999.5, gst: 17999.5 });
      expect(Math.round(((s.base ?? 0) + (s.gst ?? 0)) * 100) / 100).toBe(balance);
    }
  });

  it('a part payment keeps the ratio', () => {
    const s = paymentGstStart(59000, { total: 118000, gst: 18000 });
    expect(s).toMatchObject({ on: true, base: 50000, gst: 9000 });
  });

  it('an invoice with no GST recorded starts unticked, at the balance', () => {
    expect(paymentGstStart(50000, { total: 50000, gst: null })).toEqual({ on: false, base: 50000, gst: null, ratePercent: null });
    expect(paymentGstStart(50000, { total: 50000, gst: 0 })).toMatchObject({ on: false, base: 50000 });
  });
});
