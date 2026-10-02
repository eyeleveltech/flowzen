/**
 * The brief's small formatting rules, shared by the screen's pieces.
 */

// Spelled out: en-GB's short September is "Sept", and every other label here is three letters.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const asDay = (d: string) => new Date(`${d}T00:00:00Z`);

/** "4 Oct". */
export const shortDay = (d: string) => `${asDay(d).getUTCDate()} ${MONTHS[asDay(d).getUTCMonth()]}`;

/** "Mon 28". */
export const weekdayDate = (d: string) => `${DAYS[asDay(d).getUTCDay()]} ${asDay(d).getUTCDate()}`;

/** "22–28 Sep", or "28 Sep – 4 Oct" across a month end. */
export function weekLabel(from: string, to: string): string {
  const a = asDay(from);
  const b = asDay(to);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${shortDay(from)} – ${shortDay(to)}`;
}

/** A calendar day `n` days on. */
export function addDays(day: string, n: number): string {
  const d = asDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The calendar day a moment falls on, in the studio's timezone. */
export const localDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/**
 * Money, short: "₹1.8L", "₹45K", "₹2.1Cr" — how this studio says amounts out
 * loud. Other currencies get the platform's compact form.
 */
export function compactMoney(n: number, currency = 'INR'): string {
  if (currency !== 'INR') {
    return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  const trim = (v: number) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(n / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(n / 1e3)}K`;
  return `₹${Math.round(n)}`;
}

/** "95 min", "3.5 h", "2 working days" — how long a decision took. */
export function minutesLabel(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 480) return `${Math.round((m / 60) * 10) / 10} h`;
  return `${Math.round((m / 480) * 10) / 10} working days`;
}

/** The change against the week before, as a percentage — only when that week had something. */
export function changePct(last: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round((Math.abs(last - before) / before) * 100);
}

/** Remembered per browser; a private window or blocked storage just forgets. */
export const remembered = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* nothing to remember with */
    }
  },
};
