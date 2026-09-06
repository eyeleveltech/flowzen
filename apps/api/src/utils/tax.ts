/**
 * Indian GST Tax Calculation Utilities
 */

export interface TaxCalculationResult {
  baseAmount: number;
  taxRatePercent: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  totalAmountWithTax: number;
  isInterState: boolean;
}

/**
 * Calculates Indian Goods and Services Tax (GST).
 * Standard professional agency services rate: 18%.
 *
 * @param baseAmount Pre-tax taxable subtotal
 * @param isInterState Whether transaction is across states (IGST) or same state (CGST+SGST)
 * @param ratePercent Default 18
 */
export function calculateGst(
  baseAmount: number,
  isInterState = false,
  ratePercent = 18,
): TaxCalculationResult {
  const cleanBase = Math.max(0, Number(baseAmount) || 0);
  const totalTaxAmount = Math.round((cleanBase * ratePercent) / 100 * 100) / 100;
  const totalAmountWithTax = Math.round((cleanBase + totalTaxAmount) * 100) / 100;

  if (isInterState) {
    return {
      baseAmount: cleanBase,
      taxRatePercent: ratePercent,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: totalTaxAmount,
      totalTaxAmount,
      totalAmountWithTax,
      isInterState: true,
    };
  }

  // CGST and SGST are halves of one tax, and a half of an odd number of paise
  // is not a paisa. Rounding each half separately made both 50.01 on a 100.01
  // tax, so the two halves summed to 100.02 while `totalTaxAmount` — which is
  // what `totalAmountWithTax` is built from — still said 100.01. A document
  // whose own tax rows do not add up to its own total is one a client queries
  // and an auditor stops at.
  //
  // So one half is rounded and the other is the remainder. They always sum to
  // the tax exactly; the odd paisa lands on SGST.
  const cgstAmount = Math.round((totalTaxAmount / 2) * 100) / 100;
  const sgstAmount = Math.round((totalTaxAmount - cgstAmount) * 100) / 100;

  return {
    baseAmount: cleanBase,
    taxRatePercent: ratePercent,
    cgstAmount,
    sgstAmount,
    igstAmount: 0,
    totalTaxAmount,
    totalAmountWithTax,
    isInterState: false,
  };
}
