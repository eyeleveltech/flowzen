import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  /*
   * Starts the web app if it is not already running, and leaves a running one
   * alone. Both servers have to be up for these specs — the API separately, on
   * 4000 — and a suite that fails with ERR_CONNECTION_REFUSED tells you almost
   * nothing about which of the two it was.
   */
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180 * 1000,
  },

  projects: [
    /*
     * Signs every seeded person in once and saves the session for the run.
     *
     * The login endpoint is rate limited — 20 attempts per account and 200 per
     * address in any 15 minutes — which is right for a login endpoint and
     * exactly wrong to walk into thirty times a run. A suite that signs in per
     * test locks itself out and then reports it as "could not sign in", which
     * reads like a broken seed and is not. See tests/auth.setup.ts.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    /*
     * Removes what the specs made, after they have all finished.
     *
     * It talks to the database rather than the API on purpose: §16 makes delete
     * a SOFT delete, so cleaning up through the API leaves every probe record
     * in the bin, and the specs that count what is in there then trip over
     * their own litter. Only rows carrying the marker are touched.
     */
    { name: 'purge', testMatch: /purge\.teardown\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      teardown: 'purge',
      /*
       * The legacy specs target a /dashboard that no longer exists; they are
       * run explicitly rather than as part of this suite.
       *
       * Anchored on the path separator, because unanchored it matched any file
       * ENDING in one of these words — `retainer-projects.spec.ts` was
       * silently skipped as though it were the old `projects.spec.ts`, and a
       * skipped suite reports exactly the same as a passing one.
       */
      testIgnore: /[\\/](auth|clients|projects|settings|tasks|teams)\.spec\.ts$/,
    },
  ],
});
