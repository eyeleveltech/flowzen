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
    // This used to assert the shape /^bg-\w+-\d+ text-\w+-\d+$/, which encoded the numbered
    // Tailwind palette the avatars were built from ("bg-orange-100 text-orange-700"). The tints
    // are now steps of the neutral ramp, named from the theme tokens, so that regex described a
    // design decision rather than a requirement. What actually has to hold is that a caller gets
    // one background and one text class, from the known set — assert that instead.
    const RAMP = ['bg-subtle text-body', 'bg-line text-primary', 'bg-secondary text-white', 'bg-primary text-white'];

    it('should return a background and a text class from the neutral ramp', () => {
      const color = getAvatarColor('John Doe');
      expect(RAMP).toContain(color);
      expect(color).toMatch(/^bg-\S+ text-\S+$/);
    });

    // The point of tinting at all is telling people apart in a list of assignees, so the ramp
    // must actually spread names across more than one step.
    it('should spread different names across the ramp', () => {
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fatima', 'Grace', 'Hassan'];
      const used = new Set(names.map(getAvatarColor));
      expect(used.size).toBeGreaterThan(1);
    });

    it('should fall back to a neutral swatch for an empty name', () => {
      expect(getAvatarColor('')).toContain('bg-subtle');
    });

    it('should return consistent colors for the same name', () => {
      expect(getAvatarColor('Alice')).toBe(getAvatarColor('Alice'));
    });
  });
});
