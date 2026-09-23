import { test, expect } from '@playwright/test';
import { stateFor, apiAs } from './helpers';

/**
 * Correcting a company's status.
 *
 * §3 makes status derived: a company becomes a CLIENT because a proposal was
 * WON, which is what stops "clients" existing who never bought anything. Right
 * for new business, and it left no way to fix a wrong one — an imported company
 * arrives as a PROSPECT, and the only route to CLIENT was to invent a proposal,
 * date it and win it, which puts fiction in the win rate.
 *
 * Eighteen real companies were imported as prospects and twelve of them are
 * clients, so this is the screen that has to work.
 *
 * The test restores whatever it changed, so it can run against the development
 * database without leaving a company in the wrong state.
 */
test.describe('changing a company from prospect to client', () => {
  test.use({ storageState: stateFor('admin') });

  test('can be done in the app, and sticks', async ({ page }) => {
    const api = await apiAs('admin');
    const listed = await (await api.get('/api/companies')).json();
    const all = listed.companies ?? listed.data ?? listed;
    const subject = all.find((c: { status: string }) => c.status === 'PROSPECT');
    test.skip(!subject, 'no prospect in this database to change');

    try {
      await page.goto(`/companies/${subject.id}`);

      /*
       * The modal fetches the team to fill its Owner list, and re-renders when
       * that lands — which detaches the option mid-click if you get there
       * first. Waiting for the fetch is what makes this deterministic rather
       * than a race that passes on a fast machine.
       */
      const teamLoaded = page.waitForResponse(
        (r) => r.url().includes('/team/members'),
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await teamLoaded;

      const status = page.getByRole('combobox', { name: 'Status' });
      // The control that did not exist: the modal could edit the name, the
      // vertical, the GSTIN and the owner, but never this.
      await expect(status).toBeVisible({ timeout: 15_000 });

      // And it says plainly that this is not a won deal, because the figures
      // depend on that being true.
      await expect(page.getByText(/does not create a deal or count as a win/i)).toBeVisible();

      await status.click();
      await page.getByRole('option', { name: 'Client', exact: true }).click();
      await page.getByRole('button', { name: /^Save|Update/ }).click();

      // Persisted, not just shown — read it back from the API rather than
      // trusting the screen it was typed into.
      await expect
        .poll(async () => {
          const one = await (await api.get(`/api/companies/${subject.id}`)).json();
          return (one.company ?? one).status;
        }, { timeout: 15_000 })
        .toBe('CLIENT');
    } finally {
      // Put it back, whatever happened above.
      await api.patch(`/api/companies/${subject.id}`, { data: { status: 'PROSPECT' } });
    }
  });
});
