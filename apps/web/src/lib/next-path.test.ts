import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

/** Where sign-in goes next: only a path on this site (12 Nov — the tab trick). */
describe('safeNextPath', () => {
  it('keeps a plain path, query and all', () => {
    expect(safeNextPath('/my-work?task=abc')).toBe('/my-work?task=abc');
  });
  it('refuses another site, however it is spelled', () => {
    const backslash = String.fromCharCode(92);
    for (const raw of [
      '//evil.example',
      `/${backslash}evil.example`,
      '/\t/evil.example/x',
      '/\n/evil.example',
      'https://evil.example',
    ]) {
      expect(safeNextPath(raw)).toBe('/my-work');
    }
  });
});
