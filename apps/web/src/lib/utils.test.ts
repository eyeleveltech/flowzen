import { describe, it, expect } from 'vitest';
import { getInitials, getAvatarColor } from './utils';

describe('Utility Functions', () => {
  describe('getInitials', () => {
    it('should return the first letters of the first and last name', () => {
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('should handle single names', () => {
      expect(getInitials('Alice')).toBe('A');
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

    it('should use a neutral swatch', () => {
      expect(getAvatarColor('')).toContain('bg-subtle');
    });

    it('should return consistent colors for the same name', () => {
      expect(getAvatarColor('Alice')).toBe(getAvatarColor('Alice'));
    });
  });
});
