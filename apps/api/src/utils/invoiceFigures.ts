/**
 * Every money field an Invoice row carries.
 *
 * The routes that hand back whole invoice rows (a company, a project, a
 * retainer month) each masked `amount` for anybody without `money.figures`
 * and spread the rest through — so the printed document's subtotal, GST and
 * total, which are the same figure in other words, reached them anyway. One
 * list, applied in one place, so the next money column cannot be forgotten in
 * three of the four.
 */
export const INVOICE_MONEY_FIELDS = [
  'amount',
  'gstAmount',
  'subtotal',
  'cgstAmount',
  'sgstAmount',
  'igstAmount',
  'roundOff',
  'total',
  'amountInWords',
] as const;

/** A payment's figures: what was received, and the GST inside it. */
export const PAYMENT_MONEY_FIELDS = ['amount', 'gstAmount'] as const;

/** The row as it is, or with every figure nulled. Payments are the caller's — they are a separate list. */
export function maskInvoiceFigures<T extends object>(invoice: T, canSeeFigures: boolean): T {
  if (canSeeFigures) return invoice;
  const out = { ...invoice } as Record<string, unknown>;
  for (const field of INVOICE_MONEY_FIELDS) {
    if (field in out) out[field] = null;
  }
  return out as T;
}

/** One payment, as it is or with its figures nulled. */
export function maskPaymentFigures<T extends object>(payment: T, canSeeFigures: boolean): T {
  if (canSeeFigures) return payment;
  const out = { ...payment } as Record<string, unknown>;
  for (const field of PAYMENT_MONEY_FIELDS) {
    if (field in out) out[field] = null;
  }
  return out as T;
}
