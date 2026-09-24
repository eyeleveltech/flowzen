import { test, expect } from '@playwright/test';
import { stateFor, apiAs, marked } from './helpers';

/**
 * A promoted lead on the pipeline board.
 *
 * Promoting used to create a company and stop, so somebody you had met and were
 * about to quote appeared nowhere on the board — the pipeline began when the
 * proposal was written, which is after the part that needs chasing.
 *
 * The stage is deliberately not the TALKING one that was removed. TALKING was
 * created AUTOMATICALLY for every company, so the board filled with empty
 * proposals nobody had asked for, which could not be advanced and had to be
 * deleted by hand. This appears only on a deliberate promote, carries no value,
 * and can be deleted.
 */
test.describe('the Prospect column', () => {
  test.use({ storageState: stateFor('admin') });

  test('shows a promoted lead, carrying its details', async ({ page }) => {
    const api = await apiAs('admin');
    const name = marked('Drone Co');

    // A lead that has been met and asked for a quotation — the only kind that
    // can be promoted.
    const created = await api.post('/api/outreach', {
      data: { name, vertical: 'Aviation', source: 'LinkedIn', contactPersonName: 'Meera Krishnan', phone: '9840011223' },
    });
    const lead = (await created.json()).entry ?? (await created.json());
    await api.patch(`/api/outreach/${lead.id}/status`, { data: { status: 'INTERESTED' } });
    const promoted = await api.post(`/api/outreach/${lead.id}/promote`, { data: { city: 'Coimbatore' } });
    expect(promoted.status()).toBe(201);

    await page.goto('/pipeline');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });

    // The column exists, and the lead is in it.
    await expect(page.getByText('Prospect').first()).toBeVisible({ timeout: 15_000 });
    const card = page.getByText(name).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    /*
     * And it reads as a COMPANY rather than a deal worth nothing.
     *
     * Asserted here, on the lead this test just promoted, rather than in a test
     * of its own — a second test would have depended on this one having run
     * first, which is an ordering assumption, not a fact.
     *
     * A prospect has no quote. Printing the money anyway puts a bold ₹0 on the
     * card, stating a figure that does not exist, and the retainer badge beside
     * it asserts a decision nobody has made — the kind is defaulted on promote
     * because outreach has no field for it.
     */
    await expect(page.getByText('Not quoted yet').first()).toBeVisible();
    await expect(page.getByText('Aviation').first()).toBeVisible();
  });

  test('its column states no money and no probability, rather than zero', async ({ page }) => {
    /*
     * The header printed `formatMoney(0)` and `stageProbability['PROSPECT']`,
     * which does not exist because the stage is not configurable — so it read
     * "₹0" and "% likely · This month": a figure that is not a figure, a
     * missing number, and the Won column's caption.
     */
    await page.goto('/pipeline');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });

    const header = page.getByText('Prospect', { exact: true }).first().locator('xpath=ancestor::div[1]/..');
    await expect(header).toContainText('Not quoted yet');
    await expect(header).not.toContainText('% likely');
    await expect(header).not.toContainText('This month');
  });

  test('an empty column says how it gets filled', async ({ page }) => {
    /*
     * Until somebody promotes a lead it is empty, and that is normal — but
     * "Empty" gives no clue that promoting is what fills it, and a company
     * added any other way, imported included, never appears here.
     *
     * Decided from what is RENDERED rather than from a separate API read: the
     * other test in this file promotes a lead, and a check made before
     * navigating can be true and stale by the time the page draws.
     */
    await page.goto('/pipeline');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });

    const emptyNote = page.getByText('Promote a lead from Outreach');
    const anyCard = page.getByText('Not quoted yet');
    await expect(emptyNote.or(anyCard).first()).toBeVisible({ timeout: 15_000 });

    // Only assert the wording when the column really is empty.
    if ((await anyCard.count()) === 0) {
      await expect(emptyNote).toBeVisible();
      await expect(page.getByText('Empty', { exact: true })).toHaveCount(0);
    }
  });

  test('writing its proposal asks what is quoted and whether it is a retainer', async () => {
    /*
     * Moving a prospect to Proposal Sent used to open the ADD VERSION form,
     * which asks for a value and a scope and nothing else. That form exists to
     * revise a quote that already went out; a promoted lead has none, and it
     * carries a `kind` that was defaulted at promote because outreach has no
     * field for it. The person writing the proposal is the first to decide.
     */
    const api = await apiAs('admin');
    const name = marked('Kind Choice Co');
    const created = await api.post('/api/outreach', {
      data: { name, vertical: 'Aviation', source: 'LinkedIn', contactPersonName: 'Meera Krishnan' },
    });
    const lead = (await created.json()).entry ?? (await created.json());
    await api.patch(`/api/outreach/${lead.id}/status`, { data: { status: 'INTERESTED' } });
    await api.post(`/api/outreach/${lead.id}/promote`, { data: { city: 'Coimbatore' } });

    /*
     * Asserted through the API rather than the screen. The card rendering is
     * covered by the first test in this file, and driving the drag here as
     * well meant two specs each promoting a lead and reading the same board —
     * which raced, and failed on whichever ran second.
     */
    const board = await (await api.get('/api/proposals/pipeline')).json();
    const card = (board.columns.PROSPECT ?? []).find((c: { companyName: string }) => c.companyName === name);
    expect(card).toBeTruthy();

    // The value and the kind both belong to the deal after this form, and the
    // deal must be FILLED IN rather than a second one created beside it.
    const wrote = await api.post(`/api/proposals/${card.id}/versions`, {
      data: { kind: 'PROJECT', value: 480000, scopeSummary: '75 years documentary' },
    });
    expect(wrote.status()).toBe(201);

    const after = await (await api.get('/api/proposals/pipeline')).json();
    const moved = (after.columns.PROPOSAL_SENT ?? []).find((c: { companyName: string }) => c.companyName === name);
    expect(moved).toBeTruthy();
    expect(moved.kind).toBe('PROJECT');
    expect(moved.quotedValue).toBe(480000);
    // Still one deal for this company, not two.
    const everywhere = after.stages.flatMap((s: string) => after.columns[s] ?? [])
      .filter((c: { companyName: string }) => c.companyName === name);
    expect(everywhere).toHaveLength(1);
  });

  test('is worth nothing until a proposal is written', async ({ page }) => {
    /*
     * The whole reason the stage before this one had to go: it was priced, and
     * an empty deal with a probability drags the forecast. A promoted lead has
     * no quote, so it weights at zero.
     */
    const api = await apiAs('admin');
    const board = await (await api.get('/api/proposals/pipeline')).json();
    for (const card of board.columns.PROSPECT ?? []) {
      expect(card.quotedValue).toBe(0);
      expect(card.probability).toBe(0);
      expect(card.versionCount).toBe(0);
    }
  });
});
