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
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible({ timeout: 15_000 });
  };

  test('offers Import, and neither New nor Export', async ({ page }) => {
    await open(page);

    // Import is the one action that belongs here.
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /export/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /export/i })).toHaveCount(0);
  });

  test('still opens creation from the deep link the pipeline uses', async ({ page }) => {
    /*
     * `?create=true` is how Quick Create's "New company" and the pipeline's
     * "New lead" both arrive. Taking the button away must not take this with
     * it — that would break the two screens where a lead actually starts.
     */
    await open(page, '?create=true');
    await expect(page.getByRole('dialog').or(page.getByText(/New Client|Add Company|New Company/i)).first())
      .toBeVisible({ timeout: 15_000 });
  });
});
