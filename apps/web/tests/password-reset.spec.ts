import { test, expect, request } from '@playwright/test';
import { API_ORIGIN, PEOPLE } from './helpers';

/**
 * §16: "Password reset by email."
 *
 * Half of this existed — an admin could issue a link from Team — but the person
 * could not ask for one themselves, so the login screen said to find an admin,
 * which out of hours means the next working day.
 *
 * ─── The property that matters ──────────────────────────────────────────────
 *
 * The endpoint is unauthenticated. If "no account with that address" read any
 * differently from a real one, it would be a way to find out who works here.
 * The specs below care far more about that than about the happy path.
 *
 * Signed out on purpose: this is the one spec file about the login screen
 * itself, so it does not use a saved session.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('asking for a reset link', () => {
  test('the login screen offers it instead of telling people to find an admin', async ({ page }) => {
    await page.goto('/login');
    const link = page.getByRole('link', { name: /Forgot your password/i });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/forgot-password/);
    await expect(page.getByRole('heading', { name: /Reset your password/i })).toBeVisible();
  });

  test('says "if that address has an account", and means the if', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill(PEOPLE.employee.email);
    await page.getByRole('button', { name: /Send the link/i }).click();

    // Not "we have sent you an email" — the screen is not allowed to know.
    await expect(page.getByText(/If that address has an account here/)).toBeVisible();
    await expect(page.getByText(/works once and expires in an hour/)).toBeVisible();
  });

  test('answers a stranger exactly as it answers a real account', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill('nobody-at-all@example.com');
    await page.getByRole('button', { name: /Send the link/i }).click();

    await expect(page.getByText(/If that address has an account here/)).toBeVisible();
  });

  test('the API replies identically to both, byte for byte', async () => {
    /*
     * The screen shows whatever the server says, so this is where the property
     * actually lives. A difference of a word, a status code or a timing hint
     * would turn this endpoint into a staff directory.
     */
    const ctx = await request.newContext({ baseURL: API_ORIGIN });

    const real = await ctx.post('/api/auth/forgot-password', { data: { email: PEOPLE.employee.email } });
    const stranger = await ctx.post('/api/auth/forgot-password', { data: { email: 'nobody-at-all@example.com' } });

    expect(stranger.status()).toBe(real.status());
    expect(await stranger.text()).toBe(await real.text());
    await ctx.dispose();
  });

  test('refuses something that is not an address', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByRole('button', { name: /Send the link/i }).click();

    // The browser's own validation or the server's — either way it does not
    // pretend to have sent anything.
    await expect(page.getByText(/If that address has an account here/)).toHaveCount(0);
  });

  test('can be left without asking for anything', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('link', { name: /Back to sign in/i }).click();
    await expect(page).toHaveURL(/login/);
  });
});
