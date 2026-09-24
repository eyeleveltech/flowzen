import { test, expect } from '@playwright/test';
import { stateFor, apiAs, marked } from './helpers';

/**
 * Removing a company.
 *
 * There was no way to do it — no route, no button. A company added by mistake,
 * a typo or a duplicate, stayed for ever. `archivedAt` had been on the model
 * since the beginning and search already excluded archived rows, but nothing
 * ever set it.
 *
 * The rule is §16's: nothing is hard deleted by a user. The row and its history
 * stay, and it leaves the lists. A company carrying real work is refused, and
 * offered the honest alternative instead.
 */
test.describe('removing a company', () => {
  test.use({ storageState: stateFor('admin') });

  test('asks first, then takes it out of the list', async ({ page }) => {
    const api = await apiAs('admin');
    const name = marked('Typo Co');
    const made = await api.post('/api/companies', {
      data: { name, vertical: 'Retail', city: 'Chennai' },
    });
    // POST /companies answers with { success, data }, not { company }.
    const created = (await made.json()).data;

    await page.goto(`/companies/${created.id}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    // Asked, not done — two hundred records are one click away on this screen.
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText(/Nothing is destroyed/i);

    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

    // Back to the list, and gone from it.
    await expect(page).toHaveURL(/\/companies$/, { timeout: 15_000 });
    await expect(page.getByText(name)).toHaveCount(0);

    // Archived, not deleted: the row is still there.
    const still = await api.get(`/api/companies/${created.id}`);
    expect(still.status()).toBe(200);
  });

  test('refuses one with work on it, and offers past client instead', async ({ page }) => {
    /*
     * The important half. Removing a company with a retainer would strand that
     * retainer — a row nothing can render, because the company is the only
     * thing tying it to a client.
     */
    const api = await apiAs('admin');
    const listed = await (await api.get('/api/companies?status=CLIENT')).json();
    const withWork = (listed.companies ?? []).find(
      (c: { activeRetainer: unknown; liveProjectsCount: number }) => c.activeRetainer || c.liveProjectsCount > 0,
    );
    test.skip(!withWork, 'no client with work in this database');

    await page.goto(`/companies/${withWork.id}`);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    const first = page.getByRole('dialog').first();
    await first.getByRole('button', { name: 'Remove', exact: true }).click();

    // It says what is on the company, and what to do instead.
    const second = page.getByRole('dialog').first();
    await expect(second).toContainText(/retainer|project|invoice|proforma|proposal/i);
    await expect(second.getByRole('button', { name: /past client/i })).toBeVisible({ timeout: 15_000 });

    // Declined — the company must be untouched.
    await second.getByRole('button', { name: /cancel/i }).click();
    const after = await (await api.get(`/api/companies/${withWork.id}`)).json();
    expect((after.company ?? after).status).toBe('CLIENT');
  });
});
