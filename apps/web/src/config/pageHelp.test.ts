/**
 * The "?" on every page (Ease Plan 2, decision 5).
 *
 * The help text is a string table and How it works is a page, and nothing in
 * the compiler joins a "Read more" to the section it names on that page, or a
 * new screen to a card of its own. So this does: every link lands on a real
 * section, every screen in the sidebar has its own card, a record's page gets
 * the record's card rather than its list's, an address with no card gets the
 * general one, and no card carries an amount.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOTTOM_NAV_ITEMS, NAV_ITEMS } from './navigation';
import { GENERAL_HELP, HOW_IT_WORKS_SECTIONS, PAGE_HELP, helpFor, readMoreHref } from './pageHelp';

const DASHBOARD = resolve(__dirname, '../app/(dashboard)');
const HOW_IT_WORKS = readFileSync(join(DASHBOARD, 'how-it-works/page.tsx'), 'utf8');

/** The dashboard's pages, as the app folder writes them — `/projects/[id]`. The 404 catch-all is not a page. */
const pages = (dir: string, prefix = '', out: string[] = []): string[] => {
  const entries = readdirSync(dir);
  if (prefix && entries.includes('page.tsx')) out.push(prefix);
  for (const entry of entries) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory() || entry.startsWith('[...')) continue;
    pages(path, `${prefix}/${entry}`, out);
  }
  return out;
};
const PAGES = pages(DASHBOARD);

const ALL_HELP = [...Object.entries(PAGE_HELP), ['general', GENERAL_HELP] as const];

describe('Read more', () => {
  it.each(ALL_HELP.map(([key, help]) => [key, help.readMore ?? '(top of the page)']))(
    '%s opens a section that is in the list (%s)',
    (_key, anchor) => {
      if (anchor === '(top of the page)') return;
      expect(HOW_IT_WORKS_SECTIONS as readonly string[]).toContain(anchor);
    },
  );

  it.each(HOW_IT_WORKS_SECTIONS.map((id) => [id]))('the How it works page gives the id %s', (id) => {
    expect(HOW_IT_WORKS, `Give a section id="${id}" on how-it-works/page.tsx`).toMatch(new RegExp(`['"]${id}['"]`));
  });

  it('names each section once', () => {
    expect(new Set(HOW_IT_WORKS_SECTIONS).size).toBe(HOW_IT_WORKS_SECTIONS.length);
  });

  it('builds the link from the section', () => {
    expect(readMoreHref(PAGE_HELP['/money'])).toBe(`/how-it-works#${PAGE_HELP['/money'].readMore}`);
    expect(readMoreHref(GENERAL_HELP)).toBe('/how-it-works');
  });
});

describe('every screen has its own card', () => {
  const sidebar = [...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].filter((item) => PAGES.includes(item.href));

  it('finds the sidebar’s pages on disk', () => {
    // A guard on the guard: if this reads nothing, every check below passes on an empty list.
    expect(sidebar.length).toBeGreaterThan(15);
  });

  it.each(sidebar.map((item) => [item.label, item.href]))('%s (%s)', (_label, href) => {
    expect(PAGE_HELP[href], `Add a '${href}' entry to config/pageHelp.ts`).toBeDefined();
    expect(helpFor(href)).toBe(PAGE_HELP[href]);
  });

  it.each(PAGES.map((page) => [page]))('every dashboard page, %s included', (page) => {
    expect(PAGE_HELP[page], `Add a '${page}' entry to config/pageHelp.ts`).toBeDefined();
  });
});

describe('the most specific card wins', () => {
  it.each([
    ['/companies/c1', '/companies/[id]'],
    ['/projects/p1', '/projects/[id]'],
    ['/retainers/r1', '/retainers/[id]'],
    ['/internal-projects/i1', '/internal-projects/[id]'],
    ['/retainers/r1/projects/p1', '/retainers/[id]/projects/[projectId]'],
    ['/quotations/q1', '/quotations/[id]'],
    ['/assets/a1', '/assets/[id]'],
  ])('%s gets %s', (address, key) => {
    expect(helpFor(address)).toBe(PAGE_HELP[key]);
  });

  it('keeps a list page’s card for the list, and a record’s for the record', () => {
    expect(helpFor('/companies')).toBe(PAGE_HELP['/companies']);
    expect(helpFor('/companies/c1')).not.toBe(PAGE_HELP['/companies']);
    expect(helpFor('/quotations')).toBe(PAGE_HELP['/quotations']);
    expect(helpFor('/retainers/r1')).not.toBe(PAGE_HELP['/retainers/[id]/projects/[projectId]']);
  });

  it('reads the path, not the query or a trailing slash', () => {
    expect(helpFor('/money?tab=billing')).toBe(PAGE_HELP['/money']);
    expect(helpFor('/my-work/')).toBe(PAGE_HELP['/my-work']);
  });
});

describe('an address with no card', () => {
  it.each([['/nowhere'], ['/'], [''], ['/projects'], ['/retainers'], ['/internal-projects']])(
    '%s gets the general help',
    (address) => {
      expect(helpFor(address)).toBe(GENERAL_HELP);
    },
  );
});

describe('the words', () => {
  const textOf = (help: (typeof ALL_HELP)[number][1]) => [help.title, help.purpose, ...help.steps];

  it.each(ALL_HELP.map(([key, help]) => [key, help]))('%s says what the page is for and two or three things to do', (_key, help) => {
    expect(help.title.trim()).not.toBe('');
    expect(help.purpose.trim()).not.toBe('');
    expect(help.steps.length).toBeGreaterThanOrEqual(2);
    expect(help.steps.length).toBeLessThanOrEqual(3);
  });

  it.each(ALL_HELP.map(([key, help]) => [key, help]))('%s carries no amount', (_key, help) => {
    // Crude on purpose: a rupee sign anywhere, or a currency next to a number.
    const amount = /₹|\d\s*[$€£¥]|[$€£¥]\s*\d|\b(?:Rs\.?|INR|USD)\s*\d/i;
    for (const line of textOf(help)) expect(line).not.toMatch(amount);
  });
});
