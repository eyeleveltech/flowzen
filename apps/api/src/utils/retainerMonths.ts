/**
 * Which month a date belongs to, as the key a MonthCard is stored under.
 *
 * `MonthCard.month` is a "YYYY-MM" string and the whole product compares those
 * strings — they sort and compare correctly as text, which is why the format
 * was chosen. This exists so the two places that decide whether a retainer has
 * started yet agree on what "this month" means.
 *
 * UTC, because a retainer's `startDate` arrives as a bare "YYYY-MM-DD" and is
 * stored as midnight UTC; reading it back with local getters can land on the
 * previous day, and therefore the previous month, west of Greenwich.
 */
export const monthKey = (d: Date): string => d.toISOString().slice(0, 7);

/**
 * Has this retainer started by the given month?
 *
 * A retainer signed in September to begin in November owes nothing for
 * September or October, and a MonthCard is a bill. Both the create route and
 * the monthly roll used to open one regardless, so revenue appeared in months
 * the retainer had not started.
 */
export const hasStartedBy = (startDate: Date, month: string): boolean => monthKey(startDate) <= month;
