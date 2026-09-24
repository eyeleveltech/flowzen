import { test, expect } from '@playwright/test';
import { stateFor } from './helpers';

/**
 * What the pipeline stages are called.
 *
 * The names lived in three hand-kept copies — the board, the quotations list
 * and the API's search results — and two of them had already drifted into a
 * different case, so the same deal read "Proposal Sent" through search and
 * "Proposal sent" on the board. They come from @flowzen/shared now.
 *
 * "Proforma Issued / Contract Sent" is the renamed one: some clients get a
 * proforma and some get a contract, and it is the same stage either way.
 * Naming only the proforma made the stage look inapplicable to half the deals
 * passing through it.
 */
test.describe('pipeline stage names', () => {
  test.use({ storageState: stateFor('admin') });

  test('the board names the proforma stage for contracts too', async ({ page }) => {
    await page.goto('/pipeline');
    const board = page.locator('main').first();
    await expect(board).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Proforma Issued / Contract Sent').first()).toBeVisible({ timeout: 15_000 });
    // The old name is gone, not merely joined by the new one.
    await expect(page.getByText('Proforma issued', { exact: true })).toHaveCount(0);
  });

  test('every column reads in one case', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });

    // Title case throughout, which is what the renamed stage uses. Sentence
    // case here is the drift this consolidation removed.
    for (const name of ['Proposal Sent', 'In Negotiation', 'Verbal Yes']) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
    await expect(page.getByText('In negotiation', { exact: true })).toHaveCount(0);
  });
});
