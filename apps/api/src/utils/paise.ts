/**
 * Money as whole paise, for anything that decides whether a bill is settled.
 *
 * Amounts are stored as Decimal(12, 2) and arrive as floats, and float sums
 * drift: 0.1 + 0.2 is 0.30000000000000004, so a client who paid an invoice to
 * the paisa could be told they still owe a fraction of one, and the invoice
 * never turns Paid. Converting each amount to integer paise first, then adding
 * and comparing integers, gives the answer a person doing it by hand would.
 */

/** One amount — a number, a numeric string or a Prisma Decimal — in paise. */
export const toPaise = (value: unknown): number => Math.round(Number(value) * 100);

/** The total of a list of amounts, in paise. */
export const sumPaise = (rows: readonly { amount: unknown }[]): number =>
  rows.reduce((sum, row) => sum + toPaise(row.amount), 0);

/** "₹39,000" or "₹39,000.50", for a message a person reads. */
export const rupeesFromPaise = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
