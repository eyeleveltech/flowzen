import { describe, it, expect } from 'vitest';
import { amountInWords } from './amountInWords.js';

// Each of these figures is a real Grand Total off an EyeLevel invoice
// already issued — the wording must match exactly, not just the number.
describe('amountInWords', () => {
  it('matches the real invoices already on file', () => {
    expect(amountInWords(35400)).toBe('Rupees Thirty Five Thousand Four Hundred Only.');
    expect(amountInWords(47200)).toBe('Rupees Forty Seven Thousand Two Hundred Only.');
    expect(amountInWords(88500)).toBe('Rupees Eighty Eight Thousand Five Hundred Only.');
    expect(amountInWords(165200)).toBe('Rupees One Lakh Sixty Five Thousand Two Hundred Only.');
  });

  it('handles zero and negative as zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only.');
    expect(amountInWords(-500)).toBe('Rupees Zero Only.');
  });

  it('handles a bare hundred with nothing below it', () => {
    expect(amountInWords(100)).toBe('Rupees One Hundred Only.');
  });

  it('handles crores', () => {
    expect(amountInWords(12345678)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only.');
  });

  it('drops a zero segment rather than saying "zero thousand"', () => {
    expect(amountInWords(100005)).toBe('Rupees One Lakh Five Only.');
  });
});
