/**
 * A rupee figure, in words a person reads.
 *
 * `190000` is a number. `₹1,90,000` is money, and the Indian grouping is not
 * the default one — `toLocaleString('en-IN')` is what puts the comma after the
 * lakh rather than the thousand.
 *
 * This exists because an alert on the notification bell read "has spent past
 * its estimate of 190000" while every other figure in the product carried the
 * symbol and the grouping. The API had five separate copies of this one-liner
 * — brief.ts twice, companies.ts, proformaPdf.ts, brief.cron.ts — and the
 * scanner, the one place a figure is written into a sentence a person reads on
 * a dashboard, had none of them.
 */
export const rupees = (n: number | null | undefined): string =>
  n == null ? '—' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
