/**
 * Every internal link points at a page that exists.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 *
 * Deleting `/modules` in stage 6 left the LOGIN page pushing to it, so the first
 * thing anybody saw after signing in would have been a 404. Nothing failed to
 * compile, no test went red, and the navigation checks all passed — because the
 * sidebar was right and the broken link was somewhere else entirely.
 *
 * A dead link is the one kind of mistake this codebase cannot type-check: a
 * route is a directory on disk and a link is a string, and nothing joins them.
 * So this joins them.
 *
 * ─── What it reads ──────────────────────────────────────────────────────────
 *
 * Literal internal paths only — `href="/x"`, `router.push('/x')`, `redirect('/x')`.
 * Anything with a template hole in it (`/companies/${id}`) is matched on its static
 * prefix against the dynamic segments, because that is as far as a static reader
 * can honestly go.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const APP = join(SRC, 'app');

/** Every file worth reading, excluding what is generated. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\./.test(entry)) out.push(path);
  }
  return out;
};

/**
 * The routes Next will actually serve.
 *
 * A directory is a route when it holds a `page.tsx`. Group folders — `(dashboard)`
 * — contribute nothing to the URL, which is precisely why reading the URL off
 * the folder names by hand gets it wrong.
 */
const routes = (dir: string, prefix = '', out: string[] = []): string[] => {
  const entries = readdirSync(dir);
  if (entries.some((e) => /^page\.(tsx|jsx)$/.test(e))) out.push(prefix || '/');
  for (const entry of entries) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    const group = entry.startsWith('(') && entry.endsWith(')');
    routes(path, group ? prefix : `${prefix}/${entry}`, out);
  }
  return out;
};

const ALL_ROUTES = routes(APP);

/** Does this literal path match a real route, dynamic segments included? */
const served = (path: string): boolean =>
  ALL_ROUTES.some((route) => {
    const r = route.split('/').filter(Boolean);
    const p = path.split('/').filter(Boolean);
    if (r.length !== p.length) return false;
    // `[id]` takes anything; every other segment must match exactly.
    return r.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']')) || seg === p[i]);
  });

/** Internal paths written as literals, with any query or hash trimmed off. */
const linksIn = (source: string): string[] => {
  const found = new Set<string>();
  const patterns = [
    /href=["'](\/[^"'${}]*)["']/g,
    /(?:router\.(?:push|replace)|redirect)\(\s*["'](\/[^"'${}]*)["']/g,
  ];
  for (const re of patterns) {
    for (const [, raw] of source.matchAll(re)) {
      const path = raw.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
      // `/api/...` is the server, not a page.
      if (!path.startsWith('/api')) found.add(path);
    }
  }
  return [...found];
};

describe('the routes that exist', () => {
  it('includes the four the navigation is built on', () => {
    // /revenue was renamed /money when the section headings changed; asserting
    // the old path kept this test red against a rename that was correct.
    for (const route of ['/my-work', '/companies', '/pipeline', '/live-work', '/money']) {
      expect(ALL_ROUTES).toContain(route);
    }
  });

  it('no longer includes the module picker', () => {
    // Stage 6 deleted it. If it comes back, the switcher has come back with it.
    expect(ALL_ROUTES).not.toContain('/modules');
  });
});

describe('every link lands somewhere', () => {
  const dead: string[] = [];
  for (const file of walk(SRC)) {
    for (const link of linksIn(readFileSync(file, 'utf8'))) {
      if (!served(link)) dead.push(`${link}  ←  ${file.slice(SRC.length + 1)}`);
    }
  }

  it('points at no page that does not exist', () => {
    expect(dead).toEqual([]);
  });
});
