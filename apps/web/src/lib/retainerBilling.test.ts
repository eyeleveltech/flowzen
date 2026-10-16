import { describe, expect, it } from 'vitest';
import { billingStepFor } from './retainerBilling';

/** A month with no fee — work before a retainer starts — has nothing to bill. */
describe('billingStepFor', () => {
  const base = { billing: 'IN_ADVANCE' as const, month: '2026-10', monthOpen: true, proforma: null, invoice: null, now: new Date('2026-10-16T06:00:00Z') };

  it('a month with no fee is NO_FEE, not a proforma to raise', () => {
    expect(billingStepFor({ ...base, fee: 0 })).toBe('NO_FEE');
  });

  it('a month with a fee still asks for its proforma', () => {
    expect(billingStepFor({ ...base, fee: 235000 })).toBe('PROFORMA');
    expect(billingStepFor(base)).toBe('PROFORMA');
  });

  it('an invoice already raised wins over the fee', () => {
    expect(billingStepFor({ ...base, fee: 0, invoice: { status: 'RAISED' } as never })).toBe('PAYMENT');
  });
});
