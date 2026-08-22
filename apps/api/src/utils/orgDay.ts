/**
 * Day boundaries in an organisation's OWN timezone.
 *
 * Replaces istDay.ts, which computed boundaries from a hardcoded +05:30 offset.
 * That was wrong in two ways: it assumed every organisation is in India (master
 * plan §1.3 ⑦ — 37 hardcoded references across 9 files), and a fixed offset is
 * wrong twice a year in any zone that observes daylight saving.
 *
 * These use the IANA zone name on the organisation record, so "today", "overdue"
 * and "due in 7 days" mean what the person reading them expects.
 *
 * Why this is step 1 of the build order: everything with a date depends on it.
 */

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    // Throws RangeError on an invalid zone, which is what we want — a silent
    // fallback to UTC would shift every boundary without anyone noticing.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
};

/** The wall-clock reading in `timeZone` at the instant `date`. */
export const localParts = (date: Date, timeZone: string): LocalParts => {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Intl renders midnight as 24 in some environments with hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
};

/** Milliseconds `timeZone` is ahead of UTC at the instant `date`. */
export const zoneOffsetMs = (date: Date, timeZone: string): number => {
  const p = localParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard sub-second noise so the difference is a clean offset.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/**
 * The UTC instant of local midnight starting the day that contains `date`.
 *
 * Two passes, because the offset has to be measured *at the answer*, not at the
 * guess: on a DST boundary the offset before and after midnight differ, and a
 * single pass lands an hour out.
 */
export const startOfDay = (date: Date, timeZone: string): Date => {
  const p = localParts(date, timeZone);
  const midnightAsIfUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);

  let instant = midnightAsIfUtc - zoneOffsetMs(date, timeZone);
  instant = midnightAsIfUtc - zoneOffsetMs(new Date(instant), timeZone);

  return new Date(instant);
};

/** The last millisecond of the local day containing `date`. */
export const endOfDay = (date: Date, timeZone: string): Date =>
  new Date(startOfDay(addDays(date, 1, timeZone), timeZone).getTime() - 1);

/**
 * `date` moved by `n` local days — not by n × 86 400 000 ms.
 *
 * The difference matters on a DST boundary, where a local day is 23 or 25 hours
 * long. Adding a fixed number of milliseconds there lands on the wrong date.
 */
export const addDays = (date: Date, n: number, timeZone: string): Date => {
  const p = localParts(date, timeZone);
  const shifted = Date.UTC(p.year, p.month - 1, p.day + n, p.hour, p.minute, p.second);
  let instant = shifted - zoneOffsetMs(date, timeZone);
  instant = shifted - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
};

/** Whole local days from `b` to `a`. Positive when `a` is later. */
export const daysBetween = (a: Date, b: Date, timeZone: string): number =>
  Math.round(
    (startOfDay(a, timeZone).getTime() - startOfDay(b, timeZone).getTime()) / 86_400_000,
  );

/** `YYYY-MM-DD` in the given zone. Safe as a map key or a dedupe key. */
export const dayKey = (date: Date, timeZone: string): string => {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** True when both instants fall on the same local calendar day. */
export const isSameDay = (a: Date, b: Date, timeZone: string): boolean =>
  dayKey(a, timeZone) === dayKey(b, timeZone);

/**
 * Whether `date` is before the start of today — i.e. genuinely overdue rather
 * than merely earlier today.
 */
export const isBeforeToday = (date: Date, timeZone: string, now: Date = new Date()): boolean =>
  date.getTime() < startOfDay(now, timeZone).getTime();

/**
 * True when `timeZone` is an unambiguous IANA zone name.
 *
 * Stricter than asking Intl, deliberately. ICU also accepts abbreviations, and
 * those are ambiguous in exactly the way that produces a silent bug: "IST" is a
 * valid identifier meaning India Standard Time — and also Israel Standard Time,
 * and Irish Standard Time. Storing one on an organisation would put every day
 * boundary in the wrong place for two of the three.
 *
 * So: the Area/Location form, or UTC. Nothing else.
 */
export const isValidTimeZone = (timeZone: string): boolean => {
  if (timeZone !== 'UTC' && !/^[A-Za-z]+\/[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)?$/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};
