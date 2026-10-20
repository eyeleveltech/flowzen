/** Days late, or 0. Whole days, because "0.4 days overdue" helps nobody. */
export const daysLate = (dueAt: Date | null, now: Date): number => {
  if (!dueAt) return 0;
  const ms = now.getTime() - dueAt.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
};
