import { test, expect } from '@playwright/test';
import { stateFor } from './helpers';

/**
 * What the Companies page offers, and what it deliberately does not.
 *
 * A company is not something you start on this screen. It begins as a lead —
 * promoted from Outreach, or created as one from the pipeline, whose own note
 * puts it plainly: a pipeline starts with a lead, and a lead IS a company. A
 * "New" button beside the list was a second, quieter way in that skipped all of
 * that, and the CSV export carried every client's name and contracted monthly
 * out of the building beside a list you can already read.
 *
 * The deep link is the part worth guarding: creation still happens here, it is
 * just never STARTED here, and unmounting the modal would leave Quick Create
 * and the pipeline's "New lead" pointing at nothing. Removing a button is easy
 * to get right; removing the thing two other screens depend on is not.
 */
test.describe('the Companies page actions', () => {
  test.use({ storageState: stateFor('admin') });

  const open = async (page: import('@playwright/test').Page, query = '') => {
    await page.goto(`/companies${query}`);
    // The tab strip, not a button: what this file is about is which BUTTONS
    // the page offers, so waiting on one of them to decide the page has loaded
    // makes every test here fail for the same reason when one of them changes.
    await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 15_000 });
  };

  test('offers Import, and neither New nor Export', async ({ page }) => {
    await open(page);

    // Import is the one action that belongs here.
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /export/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /export/i })).toHaveCount(0);
  });

  test('has no way to create a company, even by the old deep link', async ({ page }) => {
    /*
     * `?create=true` used to open a company form here, and Quick Create's "New
     * company" pointed at it. A company is not created on any screen: it is an
     * outreach lead that was worth promoting, and promoting is what collects
     * the rest of its details. Two doors meant the same client could arrive
     * with no record of who found them or what was said.
     *
     * The old link lands on the list, which is the honest answer.
     */
    await open(page, '?create=true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/New Client|Add Company|New Company/i)).toHaveCount(0);
  });

  test('Quick Create sends you to outreach instead, and it opens the lead form', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /Quick create|Create|^\+$/ }).first().click();
    const item = page.getByRole('link', { name: 'New lead' }).or(page.getByText('New lead', { exact: true })).first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();

    await expect(page).toHaveURL(/\/outreach/, { timeout: 15_000 });
    // And the form it points at actually opens, rather than landing on a list.
    await expect(page.getByRole('dialog', { name: /Add to outreach list/i })).toBeVisible({ timeout: 15_000 });
  });
});
