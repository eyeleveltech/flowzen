/**
 * Working Hours Time Clock Utility
 * 
 * Rules:
 * - Agency working days: Mon–Sat (Sunday is excluded).
 * - Agency working hours: 10:00 to 19:00 IST (9 hours / 540 min per day).
 * - Time outside working hours and Sundays is excluded.
 * - Waiting time (`waitingTotalMinutes`) is deducted from the total.
 */

export interface WorkingTimeResult {
  totalMinutes: number;
  hours: number;
  minutes: number;
  formatted: string;
}

/**
 * Calculate working minutes between two timestamps in Asia/Kolkata timezone.
 */
export function calculateWorkingMinutes(
  from: Date | string,
  to: Date | string = new Date(),
  waitingTotalMinutes: number = 0,
  startHour: number = 10,
  endHour: number = 19,
  workingDays: number[] = [1, 2, 3, 4, 5, 6], // Mon-Sat
): WorkingTimeResult {
  const startDate = new Date(from);
  const endDate = new Date(to);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate >= endDate) {
    return { totalMinutes: 0, hours: 0, minutes: 0, formatted: '0m' };
  }

  // Convert to IST timestamp (+05:30)
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Shift both instants so that "IST midnight" lands on a UTC day boundary.
  // The cursor is then plain arithmetic on a number, which is what makes the
  // loop provably terminate. An earlier version compared year/month/date as
  // three independent OR'd conditions, so `date <= target.date` went true
  // again every time the cursor rolled into a new month and the loop never
  // ended — hanging the whole event loop on any task list.
  const startMs = startDate.getTime() + IST_OFFSET_MS;
  const endMs = endDate.getTime() + IST_OFFSET_MS;

  const firstDay = Math.floor(startMs / DAY_MS) * DAY_MS;
  const lastDay = Math.floor(endMs / DAY_MS) * DAY_MS;

  let accumulatedMinutes = 0;

  for (let day = firstDay; day <= lastDay; day += DAY_MS) {
    const dayOfWeek = new Date(day).getUTCDay(); // 0 = Sun, 1 = Mon, ...
    if (!workingDays.includes(dayOfWeek)) continue;

    const dayStart = day + startHour * 60 * 60 * 1000;
    const dayEnd = day + endHour * 60 * 60 * 1000;

    // Clip the working window to the part of it the clock actually covers.
    const from = Math.max(dayStart, startMs);
    const until = Math.min(dayEnd, endMs);

    if (until > from) {
      accumulatedMinutes += Math.floor((until - from) / (1000 * 60));
    }
  }

  const netMinutes = Math.max(0, accumulatedMinutes - (waitingTotalMinutes || 0));
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;

  let formatted = '';
  if (hours > 0) {
    formatted = `${hours}h ${minutes > 0 ? `${minutes}m` : ''}`.trim();
  } else {
    formatted = `${minutes}m`;
  }

  return {
    totalMinutes: netMinutes,
    hours,
    minutes,
    formatted,
  };
}
