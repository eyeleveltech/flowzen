/**
 * Repeating tasks, as the screens say them.
 *
 * One setting on a task: "Doesn't repeat", "Every working day", "Every week on
 * Thursday", "Every month on the 2nd". The day comes from the due date — the
 * labels follow it as it is picked — and the server keeps it (a copy moved off
 * a holiday does not move the rest). See services/taskRepeat on the API.
 */

export type RepeatFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** A task's repeat, as task payloads carry it. */
export type TaskRepeatInfo = {
  id: string;
  frequency: RepeatFrequency;
  weekday: number | null;
  dayOfMonth: number | null;
  stoppedAt: string | null;
  stoppedReason: string | null;
  /** The next copy's due date, "YYYY-MM-DD" — the day the job will use. */
  nextDue?: string | null;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** A "YYYY-MM-DD" (or ISO) due date's weekday and day of the month, read as a calendar day. */
const partsOf = (due: string) => {
  const d = new Date(`${due.slice(0, 10)}T00:00:00Z`);
  return { weekday: d.getUTCDay(), day: d.getUTCDate() };
};

/** The one line under the Repeat field once something is chosen. */
export const REPEAT_HINT = 'A new copy is made automatically. Stop it anytime from the task.';

/**
 * The Repeat field's options, worded from the due date: "Every week on
 * Thursday", "Every month on the 2nd" — or "Every week" / "Every month" before
 * a date is picked.
 */
export function repeatOptions(dueDate: string | null | undefined): { value: string; label: string }[] {
  const p = dueDate ? partsOf(dueDate) : null;
  return [
    { value: '', label: "Doesn't repeat" },
    { value: 'DAILY', label: 'Every working day' },
    { value: 'WEEKLY', label: p ? `Every week on ${WEEKDAYS[p.weekday]}` : 'Every week' },
    { value: 'MONTHLY', label: p ? `Every month on the ${ordinal(p.day)}` : 'Every month' },
  ];
}

/** The stored rule in words: "Every week on Thursday". */
export function repeatRuleLabel(r: Pick<TaskRepeatInfo, 'frequency' | 'weekday' | 'dayOfMonth'>): string {
  if (r.frequency === 'WEEKLY' && r.weekday != null) return `Every week on ${WEEKDAYS[r.weekday]}`;
  if (r.frequency === 'MONTHLY' && r.dayOfMonth != null) return `Every month on the ${ordinal(r.dayOfMonth)}`;
  return 'Every working day';
}

/** The tooltip on a task's repeat mark: "Repeats every Thursday". */
export function repeatTooltip(r: Pick<TaskRepeatInfo, 'frequency' | 'weekday' | 'dayOfMonth'>): string {
  if (r.frequency === 'WEEKLY' && r.weekday != null) return `Repeats every ${WEEKDAYS[r.weekday]}`;
  if (r.frequency === 'MONTHLY' && r.dayOfMonth != null) return `Repeats on the ${ordinal(r.dayOfMonth)} of every month`;
  return 'Repeats every working day';
}

/** A repeat that is still running — the only kind that gets the mark. */
export const isRepeating = (r: TaskRepeatInfo | null | undefined): r is TaskRepeatInfo => Boolean(r && !r.stoppedAt);
