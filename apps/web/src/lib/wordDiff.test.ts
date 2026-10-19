import { describe, it, expect } from 'vitest';
import { diffWords, readableDiff } from './wordDiff';

describe('diffWords', () => {
  it('marks what was taken out and what was put in', () => {
    expect(diffWords('12 posts and 8 reels a month', '16 posts and 8 reels a month')).toEqual([
      { kind: 'removed', text: '12' },
      { kind: 'added', text: '16' },
      { kind: 'same', text: ' posts and 8 reels a month' },
    ]);
  });

  it('reads the same text as unchanged, and an empty side as all new', () => {
    expect(diffWords('Same.', 'Same.')).toEqual([{ kind: 'same', text: 'Same.' }]);
    expect(diffWords('', 'New section.')).toEqual([{ kind: 'added', text: 'New section.' }]);
  });

  it('puts the two sides back together exactly', () => {
    const before = 'We plan the content, make it and run the ads.';
    const after = 'We plan the content, shoot it, edit it and run the ads every week.';
    const parts = diffWords(before, after);
    expect(parts.filter((p) => p.kind !== 'added').map((p) => p.text).join('')).toBe(before);
    expect(parts.filter((p) => p.kind !== 'removed').map((p) => p.text).join('')).toBe(after);
  });
});

describe('readableDiff', () => {
  it('shows a rewrite as old and new, not word soup', () => {
    const r = readableDiff('A year of steady growth.', 'More booked consultations, month after month.');
    expect(r.replaced).toBe(true);
    expect(r.parts.map((p) => p.kind)).toEqual(['removed', 'added']);
  });

  it('keeps the word diff for a light edit', () => {
    expect(readableDiff('12 posts and 8 reels a month', '16 posts and 8 reels a month').replaced).toBe(false);
  });
});
