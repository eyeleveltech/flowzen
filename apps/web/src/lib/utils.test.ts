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
    it('should return a valid tailwind background class', () => {
      const color = getAvatarColor('John Doe');
      expect(color).toMatch(/^bg-\w+-\d+$/);
    });

    it('should return consistent colors for the same name', () => {
      expect(getAvatarColor('Alice')).toBe(getAvatarColor('Alice'));
    });
  });
});
