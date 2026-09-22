import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PEOPLE, STATE_DIR, stateFor, type Persona } from './helpers';

/**
 * Signs each seeded person in once, and saves the session for the whole run.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Signing in inside every test is the obvious thing and it does not work here.
 * `/api/auth` carries a two-stage rate limiter — 20 attempts per account and
 * 200 per address in any 15 minutes — which is the right thing for a login
 * endpoint and exactly wrong to walk into thirty times a run. A suite that
 * logs in per test locks itself out and then reports it as "could not sign in",
 * which reads like a broken seed and is not.
 *
 * So: five logins per run, saved as storage state. A spec then declares who it
 * is with `test.use({ storageState: stateFor('bd') })` and never touches the
 * login form — except `password-reset.spec.ts`, which is about that form and
 * signs in for real.
 *
 * The session is an httpOnly cookie, which is precisely what storage state
 * captures, so this is the same session the browser would have had.
 */

/*
 * Serial, and patient.
 *
 * Five logins at once against a dev server is five browsers all waiting on the
 * first compile of the page they land on — one gets through and the rest time
 * out, which reads exactly like a broken login and is not. One at a time, and
 * long enough for a cold Next.js build.
 */
setup.describe.configure({ mode: 'serial', timeout: 120_000 });

const ALL: Persona[] = ['admin', 'bd', 'head', 'accounts', 'employee'];

for (const who of ALL) {
  setup(`sign in as ${PEOPLE[who].label}`, async ({ page }) => {
    fs.mkdirSync(path.dirname(stateFor(who)), { recursive: true });

    await page.goto('/login');
    await page.fill('input[type="email"]', PEOPLE[who].email);
    await page.fill('input[type="password"]', PEOPLE[who].password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 }),
      page.click('button[type="submit"]'),
    ]);

    // A saved state that is not actually signed in fails every spec that uses
    // it, in a way that points at the spec rather than at here.
    await expect(page).not.toHaveURL(/\/login/);
    await page.context().storageState({ path: stateFor(who) });
  });
}

setup.afterAll(() => {
  const missing = ALL.filter((w) => !fs.existsSync(stateFor(w)));
  if (missing.length) throw new Error(`no saved session for: ${missing.join(', ')} (looked in ${STATE_DIR})`);
});
