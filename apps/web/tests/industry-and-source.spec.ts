import { test, expect } from '@playwright/test';
import { stateFor } from './helpers';

/**
 * Industries and lead sources on the outreach screen.
 *
 * Both were Prisma enums — eight industries and five sources — and the words
 * "Vertical" everywhere. The lists are now sixty-seven and fourteen, stored as
 * the words themselves, and the label is Industry.
 *
 * Worth driving rather than trusting: the options come from `@flowzen/shared`
 * through `lib/vertical.ts`, and a list that silently falls back to the old
 * eight looks identical to a working one until somebody opens the dropdown.
 */
test.describe('choosing an industry and a source', () => {
  test.use({ storageState: stateFor('admin') });

  const openAddForm = async (page: import('@playwright/test').Page) => {
    await page.goto('/outreach');
    const add = page.getByRole('button', { name: /Add|New/ }).first();
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return dialog;
  };

  test('says Industry, not Vertical', async ({ page }) => {
    const dialog = await openAddForm(page);
    await expect(dialog.getByRole('combobox', { name: 'Industry' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Vertical' })).toHaveCount(0);
  });

  test('offers the full industry list, not the old eight', async ({ page }) => {
    const dialog = await openAddForm(page);
    await dialog.getByRole('combobox', { name: 'Industry' }).click();

    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(60);

    // One from the top of the list, one from the middle, one from the end —
    // so a truncated list cannot pass.
    await expect(page.getByRole('option', { name: 'Sports & Fitness', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pharmaceuticals', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Event & Sports Leagues', exact: true })).toBeVisible();
  });

  test('offers the new sources', async ({ page }) => {
    const dialog = await openAddForm(page);
    await dialog.getByRole('combobox', { name: 'Source' }).click();

    await expect(page.getByRole('option', { name: 'Justdial', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Word of Mouth', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Cold Outreach', exact: true })).toBeVisible();
    // And not the old ones, which read as shouting and no longer exist.
    await expect(page.getByRole('option', { name: 'OUTREACH', exact: true })).toHaveCount(0);
  });

  test('still shows Source in the outreach list', async ({ page }) => {
    await page.goto('/outreach');
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table.getByRole('columnheader', { name: 'Source' })).toBeVisible();
  });
});
