import { test, expect } from '@playwright/test';
import { stateFor, apiAs } from './helpers';

/**
 * Losing a deal, and saying why.
 *
 * `lostReason` has always been stored and has always been free text — a box
 * somebody typed into at the moment they were giving up on a deal, which is
 * exactly when nobody writes carefully. The column ended up holding "budget",
 * "Budget issue" and "no budget this year": three spellings of one reason,
 * which cannot be counted.
 *
 * And the board never showed Lost at all: the query kept only deals with no
 * outcome or a won one, so the screen could show the wins and not why the rest
 * went.
 */
test.describe('the Lost stage', () => {
  test.use({ storageState: stateFor('admin') });

  test('is a column, after Won', async ({ page }) => {
    await page.goto('/pipeline');
    // Wait for the columns themselves, not just the shell — reading the
    // headings before they render gives an empty list, which "does not
    // contain Won" happily agrees with.
    await expect(page.getByRole('heading', { name: 'Won', exact: true })).toBeVisible({ timeout: 15_000 });

    const headings = await page.locator('h3').allInnerTexts();
    const names = headings.map((h) => h.trim());
    expect(names).toContain('Won');
    expect(names).toContain('Lost');
    // After Won, not before it.
    expect(names.indexOf('Lost')).toBeGreaterThan(names.indexOf('Won'));
  });

  test('asks for a reason from a list, and will not save without one', async ({ page }) => {
    const api = await apiAs('admin');
    const board = await (await api.get('/api/proposals/pipeline')).json();
    const open = (board.columns.PROPOSAL_SENT ?? [])[0];
    test.skip(!open, 'no open deal to lose');

    // Reached through the company page, which is where the modal already lived.
    await page.goto(`/companies/${open.companyId}?tab=PROPOSALS`);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });

    const lose = page.getByRole('button', { name: 'Mark lost', exact: true }).first();
    // Wait for it rather than counting straight away: the proposals arrive
    // after the shell, and a count taken too early skips the whole test.
    await expect(lose).toBeVisible({ timeout: 15_000 });
    await lose.click();

    // Scoped to the modal: "Mark lost" is also the label on every proposal
    // card behind it, so an unscoped match finds three buttons.
    const modal = page.getByRole('dialog', { name: /mark this proposal lost/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });

    const reason = modal.getByRole('combobox', { name: /reason for loss/i });
    await expect(reason).toBeVisible();

    // Mandatory: nothing chosen, nothing saves.
    const submit = modal.getByRole('button', { name: 'Mark lost', exact: true });
    await expect(submit).toBeDisabled();

    // The list is the point — a fixed set is what makes the reasons countable.
    await reason.click();
    for (const option of ['Budget Issue', 'Chose Another Agency', 'No Response', 'Other']) {
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
    }

    // Other asks for words, and stays unsaveable until they are typed.
    await page.getByRole('option', { name: 'Other', exact: true }).click();
    const words = modal.getByLabel('What happened?');
    await expect(words).toBeVisible();
    await expect(submit).toBeDisabled();
    await words.fill('They merged with the agency we were pitching against');
    await expect(submit).toBeEnabled();
  });
});
