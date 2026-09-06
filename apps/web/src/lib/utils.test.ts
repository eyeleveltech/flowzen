import { describe, it, expect } from 'vitest';
import { getInitials, getAvatarColor, splitLocalDateTime, joinLocalDateTime } from './utils';

describe('Utility Functions', () => {
  describe('getInitials', () => {
    it('should return the first letters of the first and last name', () => {
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('gives a single name two letters, not one', () => {
      /*
       * Deliberately changed. Every name in this product used to carry a job
       * title — "Vikram (Developer)" — so there was always a second word to
       * take a letter from. With the title moved into its own column the names
       * are single words, and one letter turned the team's avatars into "P",
       * "T", "V", "J": a circle that no longer tells two people apart.
       */
      expect(getInitials('Alice')).toBe('AL');
      expect(getInitials('Vikram')).toBe('VI');
      // Two words still take one letter from each.
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('should handle names with extra spaces', () => {
      expect(getInitials('  Bob   Smith ')).toBe('BS');
    });

    it('should return fallback string for empty input', () => {
      expect(getInitials('')).toBe('??');
    });
  });

  describe('getAvatarColor', () => {
    // getAvatarColor returns a PAIR of classes so the initials stay legible on the tint.
    //
    // The assertions here have followed the design twice, which is the point: they now pin the
    // requirement (every avatar looks the same) rather than the implementation. The original
    // /^bg-\w+-\d+ text-\w+-\d+$/ encoded the numbered Tailwind palette; a later version asserted
    // the four-step ramp spread names across more than one step. Both described a decision that
    // has since changed.
    it('should give every name the same background and text class', () => {
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fatima', 'Grace', 'Hassan'];
      const used = new Set(names.map((n) => getAvatarColor(n)));
      expect(used.size).toBe(1);
      expect(used.has(getAvatarColor(''))).toBe(true);
    });

    it('should return a background and a text class', () => {
      expect(getAvatarColor('John Doe')).toMatch(/(^|\s)bg-\S+/);
      expect(getAvatarColor('John Doe')).toMatch(/(^|\s)text-\S+/);
    });

    it('should use the brand accent swatch', () => {
      expect(getAvatarColor('')).toContain('bg-accent');
    });

    it('should return consistent colors for the same name', () => {
      expect(getAvatarColor('Alice')).toBe(getAvatarColor('Alice'));
    });
  });

  describe('splitLocalDateTime / joinLocalDateTime', () => {
    // The pair that used to lose a day. The panel read the date in UTC and the
    // time in local, so opening a task and pressing save moved its due date.
    it('round-trips an instant through the two form fields unchanged', () => {
      const stored = new Date(2026, 7, 22, 20, 0).toISOString();
      const { date, time } = splitLocalDateTime(stored);
      expect(joinLocalDateTime(date, time)).toBe(stored);
    });

    it('round-trips an evening time, which is where the old split broke', () => {
      // 20:00 UTC reads as the NEXT day in Asia/Kolkata. Both halves have to
      // agree about which day that is.
      const stored = '2026-08-22T20:00:00.000Z';
      const { date, time } = splitLocalDateTime(stored);
      const back = joinLocalDateTime(date, time);
      expect(new Date(back!).getTime()).toBe(new Date(stored).getTime());
    });

    it('shows no time for a task that is simply due on a date', () => {
      const midnight = new Date(2026, 7, 22, 0, 0).toISOString();
      expect(splitLocalDateTime(midnight)).toEqual({ date: '2026-08-22', time: '' });
    });

    it('reads a bare date as local midnight, not as UTC midnight', () => {
      // `new Date('2026-08-22')` is UTC midnight, which is the previous evening
      // for every reader west of Greenwich — that is how the old code lost a day.
      const iso = joinLocalDateTime('2026-08-22', '');
      const d = new Date(iso!);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(22);
      expect(d.getHours()).toBe(0);
    });

    it('keeps the day when a time is given', () => {
      const iso = joinLocalDateTime('2026-08-22', '09:30');
      const d = new Date(iso!);
      expect(d.getDate()).toBe(22);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(30);
    });

    it('has nothing to say about an empty field', () => {
      expect(splitLocalDateTime(null)).toEqual({ date: '', time: '' });
      expect(joinLocalDateTime('', '09:00')).toBeNull();
    });
  });
});
