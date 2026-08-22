import { describe, it, expect } from 'vitest';
import {
  localParts,
  startOfDay,
  endOfDay,
  addDays,
  daysBetween,
  dayKey,
  isBeforeToday,
  isValidTimeZone,
} from './orgDay.js';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';
const UTC = 'UTC';

describe('orgDay', () => {
  describe('localParts', () => {
    it('reads the wall clock in the given zone, not the server default', () => {
      // 2026-03-15T20:00Z is 01:30 on the 16th in IST.
      const p = localParts(new Date('2026-03-15T20:00:00Z'), IST);
      expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 3, 16, 1, 30]);
    });

    it('renders midnight as hour 0, never 24', () => {
      expect(localParts(new Date('2026-03-15T18:30:00Z'), IST).hour).toBe(0);
    });
  });

  describe('startOfDay', () => {
    it('is local midnight, expressed as a UTC instant', () => {
      // Midnight IST on 16 March is 18:30Z on the 15th.
      expect(startOfDay(new Date('2026-03-16T09:00:00Z'), IST).toISOString()).toBe(
        '2026-03-15T18:30:00.000Z',
      );
    });

    it('is idempotent', () => {
      const once = startOfDay(new Date('2026-03-16T09:00:00Z'), IST);
      expect(startOfDay(once, IST).getTime()).toBe(once.getTime());
    });

    it('handles an instant already exactly at local midnight', () => {
      const midnight = new Date('2026-03-15T18:30:00Z');
      expect(startOfDay(midnight, IST).getTime()).toBe(midnight.getTime());
    });

    // The reason this file exists. istDay.ts used a fixed +05:30 offset, which is
    // right for India and wrong for anywhere observing daylight saving.
    it('follows daylight saving rather than a fixed offset', () => {
      // US DST began 8 March 2026. Before: UTC-5. After: UTC-4.
      const winter = startOfDay(new Date('2026-03-01T12:00:00Z'), NY);
      const summer = startOfDay(new Date('2026-03-20T12:00:00Z'), NY);
      expect(winter.toISOString()).toBe('2026-03-01T05:00:00.000Z'); // UTC-5
      expect(summer.toISOString()).toBe('2026-03-20T04:00:00.000Z'); // UTC-4
    });
  });

  describe('endOfDay', () => {
    it('is one millisecond before the next local midnight', () => {
      expect(endOfDay(new Date('2026-03-16T09:00:00Z'), IST).toISOString()).toBe(
        '2026-03-16T18:29:59.999Z',
      );
    });

    it('brackets the whole day and nothing more', () => {
      const d = new Date('2026-03-16T09:00:00Z');
      const start = startOfDay(d, IST);
      const end = endOfDay(d, IST);
      expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
    });
  });

  describe('addDays', () => {
    it('moves by local days, not by fixed milliseconds', () => {
      // Across the US spring-forward, a local day is 23 hours. Adding 86 400 000 ms
      // would land on the wrong calendar date.
      const before = new Date('2026-03-07T12:00:00Z'); // 07:00 local, DST starts the 8th
      expect(dayKey(addDays(before, 1, NY), NY)).toBe('2026-03-08');
      expect(dayKey(addDays(before, 2, NY), NY)).toBe('2026-03-09');
    });

    it('goes backwards', () => {
      expect(dayKey(addDays(new Date('2026-03-16T09:00:00Z'), -1, IST), IST)).toBe('2026-03-15');
    });

    it('rolls over month and year ends', () => {
      expect(dayKey(addDays(new Date('2026-12-31T09:00:00Z'), 1, IST), IST)).toBe('2027-01-01');
    });
  });

  describe('daysBetween', () => {
    it('counts whole local days', () => {
      const a = new Date('2026-03-20T02:00:00Z');
      const b = new Date('2026-03-15T22:00:00Z');
      expect(daysBetween(a, b, UTC)).toBe(5);
    });

    it('is zero within one local day even hours apart', () => {
      // Both are 15 March in IST despite straddling UTC midnight.
      const morning = new Date('2026-03-15T04:00:00Z');
      const night = new Date('2026-03-15T18:00:00Z');
      expect(daysBetween(night, morning, IST)).toBe(0);
    });

    it('is negative when the first instant is earlier', () => {
      expect(
        daysBetween(new Date('2026-03-15T12:00:00Z'), new Date('2026-03-18T12:00:00Z'), UTC),
      ).toBe(-3);
    });

    it('stays whole across a daylight-saving change', () => {
      // 1 -> 20 March in New York spans the spring-forward. A naive division by
      // 86 400 000 gives 18.958…, which rounds correctly here but is exactly the
      // class of drift that accumulates over a month.
      expect(daysBetween(new Date('2026-03-20T12:00:00Z'), new Date('2026-03-01T12:00:00Z'), NY)).toBe(19);
    });
  });

  describe('dayKey', () => {
    it('zero-pads to YYYY-MM-DD', () => {
      expect(dayKey(new Date('2026-01-05T09:00:00Z'), IST)).toBe('2026-01-05');
    });

    it('differs between zones for the same instant', () => {
      const instant = new Date('2026-03-15T20:00:00Z');
      expect(dayKey(instant, IST)).toBe('2026-03-16');
      expect(dayKey(instant, NY)).toBe('2026-03-15');
    });
  });

  describe('isBeforeToday', () => {
    const now = new Date('2026-03-16T09:00:00Z'); // 14:30 IST on the 16th

    it('is false for earlier the same day — that is not overdue', () => {
      expect(isBeforeToday(new Date('2026-03-16T03:00:00Z'), IST, now)).toBe(false);
    });

    it('is true for yesterday', () => {
      expect(isBeforeToday(new Date('2026-03-15T12:00:00Z'), IST, now)).toBe(true);
    });

    it('is false at exactly local midnight today', () => {
      expect(isBeforeToday(new Date('2026-03-15T18:30:00Z'), IST, now)).toBe(false);
    });
  });

  describe('isValidTimeZone', () => {
    it('accepts IANA names', () => {
      expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
      expect(isValidTimeZone('UTC')).toBe(true);
    });

    it('rejects nonsense rather than silently falling back to UTC', () => {
      expect(isValidTimeZone('Mars/Olympus')).toBe(false);
      expect(isValidTimeZone('IST')).toBe(false);
    });
  });
});
