import { describe, it, expect } from 'vitest';
import { calculateWorkingMinutes } from './workingHours.js';

/**
 * The agency clock: Mon–Sat, 10:00–19:00 IST, 540 minutes in a full day.
 *
 * Times below are written in UTC, so subtract 5h30m from the IST wall clock:
 * 10:00 IST = 04:30Z, 19:00 IST = 13:30Z.
 */
describe('calculateWorkingMinutes', () => {
  it('counts a part of one working day', () => {
    // Mon 10:00 → 13:00 IST = 3h
    const r = calculateWorkingMinutes('2026-08-24T04:30:00Z', '2026-08-24T07:30:00Z');
    expect(r.totalMinutes).toBe(180);
    expect(r.formatted).toBe('3h');
  });

  it('counts a full working day as 540 minutes', () => {
    const r = calculateWorkingMinutes('2026-08-24T04:30:00Z', '2026-08-24T13:30:00Z');
    expect(r.totalMinutes).toBe(540);
  });

  it('ignores time outside working hours', () => {
    // Assigned 08:00 IST (before open), completed 21:00 IST (after close).
    const r = calculateWorkingMinutes('2026-08-24T02:30:00Z', '2026-08-24T15:30:00Z');
    expect(r.totalMinutes).toBe(540);
  });

  it('skips Sunday', () => {
    // Sat 2026-08-29 10:00 IST → Mon 2026-08-31 10:00 IST.
    // Saturday 540 + Sunday 0 + Monday 0 (ends exactly at open) = 540.
    const r = calculateWorkingMinutes('2026-08-29T04:30:00Z', '2026-08-31T04:30:00Z');
    expect(r.totalMinutes).toBe(540);
  });

  it('deducts waiting time', () => {
    const r = calculateWorkingMinutes('2026-08-24T04:30:00Z', '2026-08-24T07:30:00Z', 60);
    expect(r.totalMinutes).toBe(120);
  });

  it('never returns a negative total', () => {
    const r = calculateWorkingMinutes('2026-08-24T04:30:00Z', '2026-08-24T07:30:00Z', 99999);
    expect(r.totalMinutes).toBe(0);
  });

  it('returns zero when the clock has not started', () => {
    expect(calculateWorkingMinutes('2026-08-24T07:30:00Z', '2026-08-24T04:30:00Z').totalMinutes).toBe(0);
    expect(calculateWorkingMinutes('nonsense', '2026-08-24T04:30:00Z').totalMinutes).toBe(0);
  });

  // ── Regression: the loop used to never terminate ──────────────────────────
  //
  // The day cursor compared year/month/date as three independent OR'd
  // conditions. Once it rolled into the next month, `date <= target.date`
  // was true again, so the loop spun forever and pinned the event loop —
  // taking the whole API down on any request that priced a task's clock.

  it('terminates when start and end fall on the last day of a month', () => {
    const r = calculateWorkingMinutes('2026-08-31T04:30:00Z', '2026-08-31T09:30:00Z');
    expect(r.totalMinutes).toBe(300);
  });

  it('terminates for a task open across a month end', () => {
    // Mon 2026-08-24 10:00 IST → Mon 2026-08-31 10:00 IST.
    // Six working days (Mon–Sat) at 540, Sunday skipped, Monday ends at open.
    const r = calculateWorkingMinutes('2026-08-24T04:30:00Z', '2026-08-31T04:30:00Z');
    expect(r.totalMinutes).toBe(6 * 540);
  });

  it('terminates for a clock left running for a year', () => {
    const r = calculateWorkingMinutes('2025-08-31T04:30:00Z', '2026-08-31T09:30:00Z');
    expect(r.totalMinutes).toBeGreaterThan(0);
    expect(Number.isFinite(r.totalMinutes)).toBe(true);
  });

  it('terminates for every start/end day pairing in a month', () => {
    // Brute force: the old bug only showed up for particular day pairings,
    // which is why it survived to production. Cover all of them.
    for (let startDay = 1; startDay <= 28; startDay++) {
      for (let endDay = startDay; endDay <= 28; endDay++) {
        const from = `2026-08-${String(startDay).padStart(2, '0')}T04:30:00Z`;
        const to = `2026-09-${String(endDay).padStart(2, '0')}T09:30:00Z`;
        expect(Number.isFinite(calculateWorkingMinutes(from, to).totalMinutes)).toBe(true);
      }
    }
  });
});
