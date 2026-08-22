import { describe, it, expect } from 'vitest';
import { fiscalYearLabel } from './documentNumber.js';

const IST = 'Asia/Kolkata';
const UTC = 'UTC';

describe('fiscalYearLabel', () => {
  describe('an April start — the Indian financial year', () => {
    const APRIL = 4;

    it('labels the span, not the calendar year', () => {
      expect(fiscalYearLabel(new Date('2026-06-15T09:00:00Z'), IST, APRIL)).toBe('2026-27');
    });

    it('keeps March in the year that is ending', () => {
      expect(fiscalYearLabel(new Date('2027-03-15T09:00:00Z'), IST, APRIL)).toBe('2026-27');
    });

    it('rolls over on 1 April', () => {
      expect(fiscalYearLabel(new Date('2027-04-01T09:00:00Z'), IST, APRIL)).toBe('2027-28');
    });

    it('pads the second half of a century boundary', () => {
      expect(fiscalYearLabel(new Date('2099-06-01T09:00:00Z'), IST, APRIL)).toBe('2099-00');
    });
  });

  // The bug this replaces: the old code used the SERVER's calendar year, so a
  // container running in UTC disagreed with the accountant for five and a half
  // hours every night — and across 31 March that meant the wrong financial year
  // on a real document.
  describe('the boundary is the organisation timezone, not the server', () => {
    // 31 March 2027, 20:00 UTC is already 01:30 on 1 April in Chennai.
    const instant = new Date('2027-03-31T20:00:00Z');

    it('is the new fiscal year in IST', () => {
      expect(fiscalYearLabel(instant, IST, 4)).toBe('2027-28');
    });

    it('is still the old one in UTC', () => {
      expect(fiscalYearLabel(instant, UTC, 4)).toBe('2026-27');
    });
  });

  describe('other fiscal years', () => {
    it('uses a plain year when the year starts in January', () => {
      expect(fiscalYearLabel(new Date('2026-06-15T09:00:00Z'), UTC, 1)).toBe('2026');
      expect(fiscalYearLabel(new Date('2026-12-31T09:00:00Z'), UTC, 1)).toBe('2026');
    });

    it('handles a July start', () => {
      expect(fiscalYearLabel(new Date('2026-06-30T09:00:00Z'), UTC, 7)).toBe('2025-26');
      expect(fiscalYearLabel(new Date('2026-07-01T09:00:00Z'), UTC, 7)).toBe('2026-27');
    });
  });
});
