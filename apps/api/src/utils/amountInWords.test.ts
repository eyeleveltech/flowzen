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

// CR-02 §7 — paise. A finished document is rounded to the rupee, so these
// cases are the un-rounded figures a caller may legitimately pass.
describe('amountInWords with paise', () => {
  it('says the paise when there are any', () => {
    expect(amountInWords(220000.5)).toBe('Rupees Two Lakh Twenty Thousand and Fifty Paise Only.');
    expect(amountInWords(1234.75)).toBe('Rupees One Thousand Two Hundred Thirty Four and Seventy Five Paise Only.');
    expect(amountInWords(99.01)).toBe('Rupees Ninety Nine and One Paise Only.');
  });

  it('stays exactly as before when the paise are zero', () => {
    expect(amountInWords(35400.0)).toBe('Rupees Thirty Five Thousand Four Hundred Only.');
  });

  it('rounds binary float slop to paise before splitting the figure', () => {
    // Three line items of 1573.33 sum to 4719.9899999999998 in a double, not
    // 4719.99. Splitting that with a bare floor and remainder reads the paise
    // off the slop; rounding to paise first is what makes the words agree with
    // the figure printed above them.
    let subtotal = 0;
    for (let i = 0; i < 3; i += 1) subtotal += 1573.33;
    expect(amountInWords(subtotal)).toBe('Rupees Four Thousand Seven Hundred Nineteen and Ninety Nine Paise Only.');
  });

  it('still reads as rupees when the whole part is zero', () => {
    expect(amountInWords(0.5)).toBe('Rupees Zero and Fifty Paise Only.');
  });
});
