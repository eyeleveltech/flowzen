/**
 * An invoice's two dates, each under its own word (QA19 fixes plan, F03):
 * "invoiced 19 Oct · due 3 Nov".
 *
 * The retainer's fee card printed the due date under the word "invoiced", so
 * an invoice raised on the 19th read as raised on the 3rd of next month. Every
 * place that names an invoice's dates on the retainer screen — the fee card,
 * the billing strip and the Invoice tab — says it this one way.
 *
 * `fmt` is the screen's own date formatter, so the zone and locale stay the
 * screen's. A missing date is left out rather than guessed.
 */
export function invoicedAndDue(
  inv: { raisedAt?: string | null; dueAt?: string | null },
  fmt: (day: string) => string,
  { capital = false }: { capital?: boolean } = {},
): string {
  const parts = [inv.raisedAt ? `invoiced ${fmt(inv.raisedAt)}` : null, inv.dueAt ? `due ${fmt(inv.dueAt)}` : null].filter(
    Boolean,
  ) as string[];
  const line = parts.length ? parts.join(' · ') : 'invoiced';
  return capital ? line.charAt(0).toUpperCase() + line.slice(1) : line;
}
