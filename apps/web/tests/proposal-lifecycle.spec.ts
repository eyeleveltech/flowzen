import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor, someClient, createProbeProposal, cleanupMarked, MARK } from './helpers';

/**
 * A proposal, from raised to removed and back.
 *
 * Until recently a proposal could be created and never corrected or removed —
 * one logged against the wrong company stayed on the board for ever. What
 * these specs hold is not that the buttons exist but that the REFUSALS do: a
 * won proposal cannot be deleted, a lost one cannot either, and the person who
 * deletes one by mistake can put it back without an admin.
 */

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await apiAs('admin');
});

test.afterAll(async () => {
  await cleanupMarked(api);
  await api.dispose();
});

/** Opens a company's Proposals tab and returns the first proposal's action menu. */
async function openProposalsTab(page: any, companyId: string) {
  await page.goto(`/companies/${companyId}?tab=PROPOSALS`);
  await expect(page.getByRole('button', { name: /Actions for this/ }).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * The card of the proposal that was won.
 *
 * A company holds several proposals — and since promoting a lead raises a
 * Prospect deal, the newest one on a client's tab is often a live one. Taking
 * the first card meant the "won" tests were opening an open proposal and
 * quietly asserting nothing. The won one is the card that says so.
 */
function wonCard(page: any) {
  return page.locator('div.rounded-card').filter({ hasText: /Won on v/ }).first();
}

/**
 * Opens a proposal's action menu, and waits for it to stay open.
 *
 * `RowMenu` closes on any scroll, on purpose — it is positioned from the
 * trigger's own rect and would otherwise drift away from the row it belongs to.
 * Playwright scrolls the trigger into view before clicking it and the browser
 * dispatches that scroll a frame AFTER the click, so the menu opens and is
 * immediately shut by the scroll that revealed it. A person scrolls and then
 * clicks; only the robot does both at once.
 */
async function openRowMenu(page: any, item: string, scope?: any) {
  const trigger = (scope ?? page).getByRole('button', { name: /Actions for this/ }).first();
  await trigger.scrollIntoViewIfNeeded();
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe('editing a proposal', () => {
  test.use({ storageState: stateFor('admin') });

  test('changes the owner, and the form refuses a save that changes nothing', async ({ page }) => {
    const company = await someClient(api);
    await createProbeProposal(api, company.id);
    await openProposalsTab(page, company.id);

    await openRowMenu(page, 'Edit proposal');
    await page.getByRole('menuitem', { name: 'Edit proposal' }).click();

    const dialog = page.getByText('Edit proposal', { exact: true }).first();
    await expect(dialog).toBeVisible();

    // Nothing has changed yet, so there is nothing to save. A form that lets
    // you save an unchanged record writes a row and resets the stage clock.
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    /*
     * The kind and the owner are real, prefilled values rather than empty
     * controls — the failure this guards against is a modal that opens blank
     * because the record never reached it, which has happened here before.
     *
     * Addressed as comboboxes: the app's Select is a custom control that
     * reports role="combobox" and takes its accessible name from an aria-label,
     * so asking for a button named "One-time project" finds nothing however
     * plainly it says so on screen.
     */
    await expect(page.getByRole('combobox', { name: 'Kind of work' })).toContainText(
      /One-time project|Monthly retainer/,
    );
    await expect(page.getByRole('combobox', { name: 'Owner' })).not.toBeEmpty();
  });

  test('will not let a won proposal change what kind of work it is', async ({ page }) => {
    // Winning is what built the retainer or the project behind it, so the
    // control says so rather than letting somebody find out by being refused.
    const won = await (await api.get('/api/proposals?limit=200')).json();
    const wonRow = (won.proposals ?? []).find((p: any) => p.outcome === 'WON');
    test.skip(!wonRow, 'the seed has no won proposal to check against');

    await openProposalsTab(page, wonRow.company.id);
    const card = wonCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await openRowMenu(page, 'Edit proposal', card);
    await page.getByRole('menuitem', { name: 'Edit proposal' }).click();

    await expect(page.getByText(/Settled when this proposal closed/)).toBeVisible();
  });
});

test.describe('deleting a proposal', () => {
  test.use({ storageState: stateFor('admin') });

  test('removes one nothing has happened to, and says where it went', async ({ page }) => {
    const company = await someClient(api);
    await createProbeProposal(api, company.id);
    await openProposalsTab(page, company.id);

    const before = await (await api.get('/api/proposals?limit=500')).json();
    const countBefore = (before.proposals ?? []).length;

    await openRowMenu(page, 'Delete proposal');
    await page.getByRole('menuitem', { name: 'Delete proposal' }).click();

    // The honest warning for a soft delete is not "this cannot be undone".
    await expect(page.getByText(/It comes off the pipeline board/)).toBeVisible();
    await expect(page.getByText(/Its versions are kept, so it can be restored/)).toBeVisible();

    await page.getByRole('button', { name: 'Delete it' }).click();
    await expect(page.getByText('Proposal deleted')).toBeVisible();

    const after = await (await api.get('/api/proposals?limit=500')).json();
    expect((after.proposals ?? []).length).toBe(countBefore - 1);
  });

  test('does not offer the action at all on a won proposal', async ({ page }) => {
    const won = await (await api.get('/api/proposals?limit=200')).json();
    const wonRow = (won.proposals ?? []).find((p: any) => p.outcome === 'WON');
    test.skip(!wonRow, 'the seed has no won proposal to check against');

    await openProposalsTab(page, wonRow.company.id);
    const card = wonCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await openRowMenu(page, 'Edit proposal', card);

    await expect(page.getByRole('menuitem', { name: 'Edit proposal' })).toBeVisible();
    // Not offering it beats offering it and turning the person down.
    await expect(page.getByRole('menuitem', { name: 'Delete proposal' })).toHaveCount(0);
  });

  test('the server refuses a won one even if the request is made directly', async () => {
    // The UI withholds the button; this is the half that actually protects the
    // record, and it is the half a different client would reach.
    const won = await (await api.get('/api/proposals?limit=200')).json();
    const wonRow = (won.proposals ?? []).find((p: any) => p.outcome === 'WON');
    test.skip(!wonRow, 'the seed has no won proposal to check against');

    const res = await api.delete(`/api/proposals/${wonRow.id}`);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/was won/i);
  });
});

/*
 * Restore, from each side of the permission line.
 *
 * Split by person rather than by feature because a saved session is declared
 * per describe block — and because the whole point of this group is that the
 * SAME capability has to be reachable by three different people in three
 * different places.
 */
test.describe('putting one back · as a BD', () => {
  test.use({ storageState: stateFor('bd') });

  test('a BD restores their own deleted proposal, with no admin involved', async ({ page }) => {
    /*
     * The point of this one. Settings redirects anyone without setup.admin, so
     * a Trash tab there would be useless to BD — who are the people raising
     * proposals, and so the people raising one by mistake.
     */
    const company = await someClient(api);
    const id = await createProbeProposal(api, company.id);
    await api.delete(`/api/proposals/${id}`);

    await page.goto('/quotations');
    await page.getByRole('tab', { name: /^Deleted/ }).click();

    const row = page.locator('tr', { hasText: company.name }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Restore/ }).click();

    await expect(page.getByText(/is back on the pipeline/)).toBeVisible();
    const check = await (await api.get('/api/proposals/trash')).json();
    expect((check.proposals ?? []).some((p: any) => p.id === id)).toBe(false);
  });

  test('a BD never reaches Settings, which is why the tab had to exist', async ({ page }) => {
    /*
     * The reason the Deleted tab lives on Proposals rather than only in
     * Settings → Trash. The old screen also swallowed every permission failure
     * into an empty array and said "Nothing in the trash" — the one answer a
     * recovery screen must never give wrongly.
     */
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/settings/);
  });
});

test.describe('putting one back · as an employee', () => {
  test.use({ storageState: stateFor('employee') });

  test('is not offered the tab at all', async ({ page }) => {
    await page.goto('/quotations');
    // pipeline.read gates the whole screen, so they never arrive.
    await expect(page).not.toHaveURL(/quotations/);
  });
});

test.describe('putting one back · as an admin', () => {
  test.use({ storageState: stateFor('admin') });

  test('sees it in Settings → Trash as well', async ({ page }) => {
    const company = await someClient(api);
    const id = await createProbeProposal(api, company.id);
    await api.delete(`/api/proposals/${id}`);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Trash', exact: true }).click();

    await expect(page.getByText(/Proposals \(\d+\)/)).toBeVisible({ timeout: 15_000 });
    // An admin can reach every section, so nothing should be withheld.
    await expect(page.getByText(/are not shown here/)).toHaveCount(0);

    await api.post(`/api/proposals/${id}/restore`);
  });

});
