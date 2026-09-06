/**
 * What a piece of kit is worth now.
 *
 * ─── Computed on read, never stored ─────────────────────────────────────────
 *
 * The same discipline the app already applies to retainer profitability, and
 * for the same reason: a stored book value is wrong the day after it is
 * written, and nothing tells you which of the two numbers on your screen is
 * the stale one. Straight-line depreciation is four multiplications. There is
 * no version of "cache it" that is cheaper than being right.
 *
 * ─── The basis ──────────────────────────────────────────────────────────────
 *
 * Companies Act Schedule II straight-line, which is what `ASSET_USEFUL_LIFE`
 * in @flowzen/shared is shaped around. The Income Tax written-down-value rates
 * are a different basis and would give a different closing figure; which one
 * the register should mirror is the CA's call, and worth settling before the
 * first FY schedule is handed over. Nothing here assumes the answer beyond the
 * arithmetic itself — swapping the basis means changing this one file.
 */

/**
 * Whole months between two dates.
 *
 * WHOLE months, deliberately. A lens bought on the 20th has not depreciated by
 * the 25th, and part-month proration would put fractions of a rupee into a
 * schedule an accountant reads. The month ticks over on the day-of-month, so
 * 20 Jan → 19 Feb is zero months and 20 Jan → 20 Feb is one.
 */
export function wholeMonthsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

export type DepreciableAsset = {
  purchasePrice: number;
  salvageValue: number;
  usefulLifeMonths: number;
  purchasedAt: Date;
};

/** `(cost − salvage) ÷ life`. Zero when the life is not a positive number. */
export function monthlyDepreciation(asset: DepreciableAsset): number {
  if (!Number.isFinite(asset.usefulLifeMonths) || asset.usefulLifeMonths <= 0) return 0;
  const depreciable = asset.purchasePrice - asset.salvageValue;
  if (depreciable <= 0) return 0;
  return depreciable / asset.usefulLifeMonths;
}

/**
 * Book value on a given date, clamped at salvage.
 *
 * The clamp is the whole point of the `max`: an asset past the end of its life
 * sits at its salvage value forever. It does NOT keep falling, and it must
 * never go negative — a register showing a camera worth minus eleven thousand
 * rupees is a register nobody trusts again.
 */
export function bookValue(asset: DepreciableAsset, asOf: Date = new Date()): number {
  const elapsed = wholeMonthsBetween(asset.purchasedAt, asOf);
  const raw = asset.purchasePrice - monthlyDepreciation(asset) * elapsed;
  return round2(Math.max(asset.salvageValue, raw));
}

/**
 * Has it run out its life?
 *
 * Flagged *due for replacement*, not auto-retired. A five-year-old lens that
 * still works is still an asset, and a register that quietly retires kit on an
 * anniversary stops describing the office.
 */
export function fullyDepreciated(asset: DepreciableAsset, asOf: Date = new Date()): boolean {
  if (asset.usefulLifeMonths <= 0) return false;
  return wholeMonthsBetween(asset.purchasedAt, asOf) >= asset.usefulLifeMonths;
}

/**
 * The financial year `2026-27` as the two dates that bracket it.
 *
 * `startMonth` comes from `Organization.financialYearStart`, which already
 * exists and already defaults to April — this needed no new setting.
 * The window is [start, endExclusive), so a purchase on 31 March falls in the
 * year that is ending and one on 1 April in the year beginning.
 */
export function financialYearWindow(
  label: string,
  startMonth = 4,
): { start: Date; endExclusive: Date; label: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(label.trim());
  const startYear = match ? Number(match[1]) : new Date().getFullYear();
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const endExclusive = new Date(Date.UTC(startYear + 1, startMonth - 1, 1));
  return { start, endExclusive, label };
}

/** The financial year a date falls in, as `2026-27`. */
export function financialYearOf(date: Date, startMonth = 4): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() + 1 < startMonth ? year - 1 : year;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export type RegisterRow = {
  openingWdv: number;
  depreciationForYear: number;
  closingWdv: number;
};

/**
 * One asset's row in the FY schedule an accountant expects.
 *
 * Opening WDV is the book value on the first day of the year — zero for an
 * asset bought during it, which is exactly right: it was not on the books yet.
 * Depreciation for the year is the fall between the two ends of the window, so
 * an asset that hits the end of its life mid-year contributes only the months
 * it was actually being written off for, and one bought mid-year contributes
 * only the months since. Neither case needs a special branch — the clamp inside
 * `bookValue` handles both.
 */
export function registerRow(
  asset: DepreciableAsset,
  window: { start: Date; endExclusive: Date },
): RegisterRow {
  const boughtAfterYearEnd = asset.purchasedAt >= window.endExclusive;
  if (boughtAfterYearEnd) return { openingWdv: 0, depreciationForYear: 0, closingWdv: 0 };

  const openingWdv = asset.purchasedAt >= window.start ? 0 : bookValue(asset, window.start);
  // The closing figure is read a day BEFORE the next year opens, so the year's
  // last month is counted in the year it belongs to rather than the next one.
  const closingAt = new Date(window.endExclusive.getTime() - 1);
  const closingWdv = bookValue(asset, closingAt);

  const openedAt = asset.purchasedAt >= window.start ? asset.purchasePrice : openingWdv;
  return {
    openingWdv: round2(openingWdv),
    depreciationForYear: round2(Math.max(0, openedAt - closingWdv)),
    closingWdv: round2(closingWdv),
  };
}

/** Rupees and paise. Money is never carried at floating-point precision. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
