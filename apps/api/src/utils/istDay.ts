// Day boundaries computed in IST (the business timezone), independent of the server's
// local timezone. A UTC-deployed container otherwise shifts every "due today" / "overdue"
// boundary by 5h30m, mislabeling tasks around midnight IST.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export const istDayIndex = (d: Date): number => Math.floor((d.getTime() + IST_OFFSET_MS) / 86400000);

/** Start of the IST calendar day containing `d` (as a UTC Date instant). */
export const istStartOfDay = (d: Date = new Date()): Date => new Date(istDayIndex(d) * 86400000 - IST_OFFSET_MS);

/** End (last ms) of the IST calendar day containing `d`. */
export const istEndOfDay = (d: Date = new Date()): Date => new Date((istDayIndex(d) + 1) * 86400000 - IST_OFFSET_MS - 1);

/** Whole IST days between two instants (a - b). */
export const istDaysBetween = (a: Date, b: Date): number => istDayIndex(a) - istDayIndex(b);
