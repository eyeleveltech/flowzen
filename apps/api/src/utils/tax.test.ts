import { describe, it, expect } from 'vitest';
import { computeTaxSplit, sameState, TaxConfigurationError } from './tax.js';

const str = (d: { toString(): string }) => d.toString();

describe('tax', () => {
  describe('sameState', () => {
    it('matches identical names', () => {
      expect(sameState('Tamil Nadu', 'Tamil Nadu')).toBe(true);
    });

    it('ignores case, spacing and punctuation — these are typed by hand twice', () => {
      expect(sameState('Tamil Nadu', 'TAMILNADU')).toBe(true);
      expect(sameState('Tamil  Nadu', 'tamil nadu')).toBe(true);
      expect(sameState('Jammu & Kashmir', 'Jammu and Kashmir')).toBe(false); // genuinely different text
    });

    it('is false when either side is missing', () => {
      expect(sameState('Tamil Nadu', null)).toBe(false);
      expect(sameState(null, 'Tamil Nadu')).toBe(false);
      expect(sameState('', 'Tamil Nadu')).toBe(false);
    });

    it('distinguishes different states', () => {
      expect(sameState('Tamil Nadu', 'Karnataka')).toBe(false);
    });
  });

  describe('computeTaxSplit', () => {
    it('splits within one state into CGST and SGST', () => {
      const t = computeTaxSplit(100000, 18, 'Tamil Nadu', 'Tamil Nadu');
      expect(t.kind).toBe('INTRA_STATE');
      expect(str(t.cgst)).toBe('9000');
      expect(str(t.sgst)).toBe('9000');
      expect(str(t.igst)).toBe('0');
      expect(str(t.total)).toBe('118000');
    });

    it('charges IGST across states', () => {
      const t = computeTaxSplit(100000, 18, 'Tamil Nadu', 'Karnataka');
      expect(t.kind).toBe('INTER_STATE');
      expect(str(t.cgst)).toBe('0');
      expect(str(t.sgst)).toBe('0');
      expect(str(t.igst)).toBe('18000');
      expect(str(t.total)).toBe('118000');
    });

    it('charges the same total either way — only the split differs', () => {
      const intra = computeTaxSplit(87654.32, 18, 'Tamil Nadu', 'Tamil Nadu');
      const inter = computeTaxSplit(87654.32, 18, 'Tamil Nadu', 'Karnataka');
      expect(str(intra.total)).toBe(str(inter.total));
    });

    it('halves without losing a paisa', () => {
      // 18% of 1000.05 is 180.009 -> 180.01. Halved that is 90.005 each, which
      // rounds to 90.01 twice and sums to 180.02 if each half is rounded alone.
      const t = computeTaxSplit('1000.05', 18, 'Tamil Nadu', 'Tamil Nadu');
      expect(str(t.cgst.add(t.sgst))).toBe('180.01');
      expect(str(t.total)).toBe('1180.06');
    });

    it('treats an unknown buyer state as inter-state', () => {
      const t = computeTaxSplit(100000, 18, 'Tamil Nadu', null);
      expect(t.kind).toBe('INTER_STATE');
      expect(str(t.igst)).toBe('18000');
    });

    it('applies no tax at a zero rate', () => {
      const t = computeTaxSplit(100000, 0, 'Tamil Nadu', 'Karnataka');
      expect(str(t.cgst)).toBe('0');
      expect(str(t.igst)).toBe('0');
      expect(str(t.total)).toBe('100000');
    });

    it('handles a zero amount', () => {
      const t = computeTaxSplit(0, 18, 'Tamil Nadu', 'Tamil Nadu');
      expect(str(t.total)).toBe('0');
    });

    // The reason Organization.state was added at all.
    it('refuses rather than guessing when the seller state is unset', () => {
      expect(() => computeTaxSplit(100000, 18, null, 'Karnataka')).toThrow(TaxConfigurationError);
      expect(() => computeTaxSplit(100000, 18, '  ', 'Karnataka')).toThrow(/state is not set/i);
    });

    it('rejects negative money outright', () => {
      expect(() => computeTaxSplit(-1, 18, 'Tamil Nadu', 'Tamil Nadu')).toThrow(TaxConfigurationError);
      expect(() => computeTaxSplit(100, -5, 'Tamil Nadu', 'Tamil Nadu')).toThrow(TaxConfigurationError);
    });

    it('keeps precision on awkward amounts', () => {
      // A repeating decimal — the case that goes wrong with floating point.
      const t = computeTaxSplit('33333.33', 18, 'Tamil Nadu', 'Karnataka');
      expect(str(t.igst)).toBe('6000');
      expect(str(t.total)).toBe('39333.33');
    });
  });
});
