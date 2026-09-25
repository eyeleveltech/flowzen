import { test, expect } from '@playwright/test';
import { stateFor, apiAs } from './helpers';

/**
 * The two list settings, and why they are no longer a box you type into.
 *
 * Departments and public holidays were both a textarea, one value per line,
 * split apart on save. That control cannot tell you anything: it accepts the
 * same department twice with different capitals, a trailing blank line, and a
 * date written 14-01-2026 — and none of it is discovered here, only later, by
 * the screen that reads the list. "Video & Production" living beside "Video /
 * Production" is exactly what it allowed, and exactly what the setting exists
 * to let somebody clean up.
 *
 * Each value is its own row now, added one at a time by a control that knows
 * what is already on the list.
 */
test.describe('the list settings', () => {
  test.use({ storageState: stateFor('admin') });

  const PROBE = 'Client Servicing (E2E-PROBE)';

  test('adds a department one at a time, and refuses a duplicate', async ({ page }) => {
    const api = await apiAs('admin');
    const before: string[] = (await (await api.get('/api/config')).json()).organization.departments ?? [];
    expect(before.length, 'no departments to show as rows').toBeGreaterThan(0);

    try {
      await page.goto('/settings');
      const add = page.getByLabel('Add a department');
      await expect(add).toBeVisible({ timeout: 20_000 });

      // A list of rows, not one string in a box.
      await expect(page.getByRole('textbox', { name: 'Departments' })).toHaveCount(0);
      const list = page.getByRole('list', { name: 'Departments' });
      await expect(list.getByRole('listitem')).toHaveCount(before.length);
      // Each row can be taken off on its own. Exact, because this org holds
      // both "Accounts" and "Accounts / Finance" — which is the duplication the
      // setting exists to let somebody clean up.
      await expect(list.getByRole('button', { name: `Remove ${before[0]}`, exact: true })).toBeVisible();

      // One typed in is refused if the list already holds it — whatever the case.
      await add.fill(before[0].toUpperCase());
      await page.getByRole('button', { name: 'Add a department' }).click();
      await expect(page.getByText(/is already on the list/)).toBeVisible();
      await expect(list.getByRole('listitem')).toHaveCount(before.length);

      // A new one is added as its own row, and saves.
      await add.fill(PROBE);
      await page.getByRole('button', { name: 'Add a department' }).click();
      await expect(list.getByRole('listitem')).toHaveCount(before.length + 1);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

      await expect
        .poll(
          async () => ((await (await api.get('/api/config')).json()).organization.departments ?? []) as string[],
          { timeout: 15_000 },
        )
        .toContain(PROBE);

      // And removed the same way, a row at a time.
      await page.reload();
      await page.getByRole('button', { name: `Remove ${PROBE}` }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () => ((await (await api.get('/api/config')).json()).organization.departments ?? []) as string[],
          { timeout: 15_000 },
        )
        .not.toContain(PROBE);
    } finally {
      await api.patch('/api/config', { data: { departments: before } });
    }
  });

  test('asks for a holiday as a date, not as a spelling of one', async ({ page }) => {
    await page.goto('/settings');
    const add = page.getByLabel('Add a holiday');
    await expect(add).toBeVisible({ timeout: 20_000 });
    // A date picker: the old box asked for YYYY-MM-DD in words and accepted
    // anything at all.
    await expect(add).toHaveAttribute('type', 'date');
    await expect(page.getByRole('textbox', { name: 'Public holidays' })).toHaveCount(0);
  });
});
