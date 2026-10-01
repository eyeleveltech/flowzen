/**
 * A task's optional due time, as people read it.
 *
 * Stored as "17:30" (24-hour, office time) beside the due date, and empty for
 * most tasks — the date is the deadline; the time is for the ones that need
 * one. Shown right after the date wherever the date is: "9 Oct · 5:30 pm".
 */

/** "17:30" → "5:30 pm", "09:00" → "9:00 am". Empty for no time. */
export function dueTimeLabel(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Every 15 minutes of the day, as the picker offers them: "9:00 am" … "11:45 pm".
 * The dropdown has a search box, so typing "5:30" leaves "5:30 am" and "5:30 pm".
 * A saved time off the 15-minute grid (17:20, say) is kept as an option too.
 */
export function dueTimeOptions(current?: string | null): { value: string; label: string }[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  if (current && !slots.includes(current)) slots.push(current);
  slots.sort();
  return [{ value: '', label: 'No time' }, ...slots.map((v) => ({ value: v, label: dueTimeLabel(v) }))];
}

/** The date as the screen formats it, with " · 5:30 pm" when there is a time. */
export function withDueTime(dateText: string, time: string | null | undefined): string {
  const t = dueTimeLabel(time);
  return t ? `${dateText} · ${t}` : dateText;
}
