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
    // getAvatarColor returns a PAIR of classes ("bg-orange-100 text-orange-700") so the initials
    // stay legible on the tint. The old assertion expected a lone background class and had been
    // failing ever since the text colour was added.
    it('should return matching background and text classes', () => {
      const color = getAvatarColor('John Doe');
      expect(color).toMatch(/^bg-\w+-\d+ text-\w+-\d+$/);
    });

    it('should fall back to a neutral swatch for an empty name', () => {
      expect(getAvatarColor('')).toContain('bg-[#F3F4F6]');
    });

    it('should return consistent colors for the same name', () => {
      expect(getAvatarColor('Alice')).toBe(getAvatarColor('Alice'));
    });
  });
});
