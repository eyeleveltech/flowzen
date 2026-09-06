/**
 * A person's "normal load" — brief: person overloaded/underloaded compares
 * open tasks against "that person's trailing 8 week median", not a flat
 * number every person is held to regardless of role or how busy their desk
 * usually is.
 *
 * Reconstructed from assignedAt/completedAt rather than a stored weekly
 * snapshot: a task counts toward week N's load if it had been assigned by
 * that week's end and hadn't been completed before that week started —
 * i.e., it was open at some point during the week.
 */

export type LoadTask = {
  assignedAt: Date | string;
  completedAt: Date | string | null;
};

const WEEK_MS = 7 * 24 * 3600 * 1000;

export function weeklyOpenCounts(tasks: LoadTask[], now: Date = new Date(), weeks = 8): number[] {
  const counts: number[] = [];
  for (let i = 0; i < weeks; i++) {
    const weekEnd = new Date(now.getTime() - i * WEEK_MS);
    const weekStart = new Date(weekEnd.getTime() - WEEK_MS);
    const count = tasks.filter((t) => {
      const assignedAt = new Date(t.assignedAt);
      const completedAt = t.completedAt ? new Date(t.completedAt) : null;
      return assignedAt <= weekEnd && (!completedAt || completedAt > weekStart);
    }).length;
    counts.push(count);
  }
  return counts;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * `openTasks / median x 100`, with a flat 5-task fallback baseline for
 * someone with no real history yet (median 0) — otherwise a first task ever
 * assigned reads as an infinite load spike.
 */
export function loadPercentage(tasks: LoadTask[], currentOpenCount: number, now: Date = new Date()): number {
  const weeklyMedian = median(weeklyOpenCounts(tasks, now));
  const baseline = weeklyMedian > 0 ? weeklyMedian : 5;
  return Math.round((currentOpenCount / baseline) * 100);
}
