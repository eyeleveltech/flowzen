import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MENU_ITEMS, HOME_HREF } from './navMenu.js';

/**
 * The server's copy of the sidebar list must be the web's list.
 *
 * `PATCH /profile/menu` keeps only hrefs this person is offered, by the gates
 * in MENU_ITEMS. If a screen is added to the web's NAV_ITEMS and not here, it
 * can never be pinned; if a gate changes on one side only, the server keeps a
 * pin the sidebar would never draw, or refuses one it would. So this reads the
 * web file's own text — the list is not imported, it carries icons — and
 * compares href, permission and the two preset gates, in order.
 */

const WEB_NAV = resolve(__dirname, '../../../web/src/config/navigation.ts');

const webItems = () => {
  const source = readFileSync(WEB_NAV, 'utf8');
  const start = source.indexOf('export const NAV_SECTIONS');
  const end = source.indexOf('export const BOTTOM_NAV_ITEMS');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);

  const items = [...block.matchAll(/\{\s*label:\s*'[^']*',\s*href:\s*'([^']+)'([^}]*)\}/g)].map(([, href, rest]) => {
    const needs = rest.match(/needs:\s*'([^']+)'/)?.[1];
    return {
      href,
      ...(needs ? { needs } : {}),
      ...(/managementOnly:\s*true/.test(rest) ? { managementOnly: true } : {}),
      ...(/headsOnly:\s*true/.test(rest) ? { headsOnly: true } : {}),
    };
  });

  // Every `href:` in the block was read — an item written across several
  // lines would otherwise drop out of the comparison without a word.
  expect(items.length).toBe((block.match(/\bhref:\s*'/g) ?? []).length);
  return items;
};

describe('the server’s menu list', () => {
  it('is the web’s NAV_ITEMS — same hrefs, same order, same gates', () => {
    expect(MENU_ITEMS.map((i) => ({ ...i }))).toEqual(webItems());
  });

  it('has My Work, ungated, as its home', () => {
    expect(MENU_ITEMS[0]).toEqual({ href: HOME_HREF });
  });
});
