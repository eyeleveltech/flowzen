import { describe, it, expect } from 'vitest';
import { computeQuoteFinancials } from '../utils/quote.js';

describe('Regression & Permission Tests', () => {
  describe('Money Math (FZ-083)', () => {
    it('rounds grandTotal to whole rupees at source', () => {
      const lineItems = [
        { description: 'Item 1', quantity: 1, unitPrice: 1046.24, taxPct: 18, taxType: 'GST' }
      ];
      const result = computeQuoteFinancials(lineItems);
      
      // Untaxed = 1046.24, Tax = 188.32 -> raw 1234.56 -> Math.round -> 1235
      expect(Number.isInteger(result.grandTotal)).toBe(true);
      expect(result.grandTotal).toBe(1235);
      expect(result.amountInWords).not.toContain('undefined');
    });
  });

  describe('Module & Role Isolation Logic', () => {
    it('verifies computeQuoteFinancials returns structured financial fields', () => {
      const lineItems = [
        { description: 'Service A', quantity: 2, unitPrice: 500, taxPct: 18, taxType: 'IGST' }
      ];
      const result = computeQuoteFinancials(lineItems);

      expect(result.untaxedAmount).toBe(1000);
      expect(result.igst).toBe(180);
      expect(result.totalTax).toBe(180);
      expect(result.grandTotal).toBe(1180);
    });
  });
});
