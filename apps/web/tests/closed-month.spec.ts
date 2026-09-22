import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor } from './helpers';

/**
 * A closed month is a reported month.
 *
 * Closing a month card is what fixes its profit: the fee is settled, the costs
 * are in, and somebody has looked at the margin and acted on it. The screen
 * showed a closed month as fully editable — Task and Cost enabled, every
 * status dropdown live — and the API agreed, so a cost entered in September
 * against August silently moved a number that had already been reported.
 *
 * The refusal alone would not be enough. Offering no way through would only
 * mean the real correction — a vendor bill that genuinely belongs to August —
 * never gets recorded, and the figure stays wrong for a better-sounding
 * reason. So the last test here is the way back in.
 */

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
/** A retainer with a closed month, found rather than assumed. */
let closed: { retainerId: string; month: string; cardId: string } | null = null;

test.beforeAll(async () => {
  admin = await apiAs('admin');
  const list = await (await admin.get('/api/retainers?limit=20')).json();
  for (const r of list.retainers ?? list.data ?? []) {
    const detail = await (await admin.get(`/api/retainers/${r.id}`)).json();
    const card = (detail.retainer?.monthCards ?? []).find((m: any) => m.status === 'CLOSED');
    if (card) {
      closed = { retainerId: r.id, month: card.month, cardId: card.id };
      break;
    }
  }
});

test.afterAll(async () => {
  await admin.dispose();
});

test.describe('on the server', () => {
  test('a cost cannot be entered against it', async () => {
    test.skip(!closed, 'no closed month in this database');
    const res = await admin.post('/api/costs', {
      data: { monthCardId: closed!.cardId, category: 'Ad Spend', vendor: 'E2E-PROBE closed', amount: 99999 },
    });
    expect(res.status()).toBe(400);
    // The month is named the way the screen names it — "August 2026", not a key.
    expect((await res.json()).error).toMatch(/is closed/i);
  });

  test('a task cannot be added to it', async () => {
    test.skip(!closed, 'no closed month in this database');
    const res = await admin.post('/api/tasks', {
      data: {
        title: 'E2E-PROBE closed month task',
        workType: 'MONTH_CARD',
        monthCardId: closed!.cardId,
        dueDate: '2026-08-30',
      },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('on the screen · as an admin', () => {
  test.use({ storageState: stateFor('admin') });

  test('says it is closed, and stops offering the actions', async ({ page }) => {
    test.skip(!closed, 'no closed month in this database');
    await page.goto(`/retainers/${closed!.retainerId}?month=${closed!.month}`);

    // The badge, so which month you are in is unmissable once it is shut.
    await expect(page.getByText(/closed$/i).first()).toBeVisible({ timeout: 15_000 });

    // Disabled, not hidden: the actions still belong on this screen, they are
    // just not available for this month, and a missing button explains nothing.
    await expect(page.getByRole('button', { name: 'Task', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cost', exact: true })).toBeDisabled();

    // Reopening a finished task would move the month's "tasks done" after the
    // fact and bump the rework count the aging rules read.
    const statuses = page.getByRole('combobox', { name: /^Status for / });
    if ((await statuses.count()) > 0) await expect(statuses.first()).toBeDisabled();
  });

  test('offers a deliberate way back in', async ({ page }) => {
    test.skip(!closed, 'no closed month in this database');
    await page.goto(`/retainers/${closed!.retainerId}?month=${closed!.month}`);
    await expect(page.getByRole('button', { name: /Reopen month/i })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('the open month beside it', () => {
  test.use({ storageState: stateFor('admin') });

  test('is untouched by any of this', async ({ page }) => {
    const list = await (await admin.get('/api/retainers?limit=20')).json();
    let open: { id: string; month: string } | null = null;
    for (const r of list.retainers ?? list.data ?? []) {
      const detail = await (await admin.get(`/api/retainers/${r.id}`)).json();
      const card = (detail.retainer?.monthCards ?? []).find((m: any) => m.status === 'OPEN');
      if (card) {
        open = { id: r.id, month: card.month };
        break;
      }
    }
    test.skip(!open, 'no open month in this database');

    await page.goto(`/retainers/${open!.id}?month=${open!.month}`);
    await expect(page.getByRole('button', { name: 'Task', exact: true })).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Reopen month/i })).toHaveCount(0);
  });
});

test.describe('the month figures do not claim what nobody entered', () => {
  test.use({ storageState: stateFor('admin') });

  test('a card with no costs says so rather than reporting a 100% margin', async ({ page }) => {
    /*
     * With no cost rows and nobody allocated the arithmetic returns the whole
     * fee and a 100% margin, and the dark tile — the one designed to be read
     * first — said exactly that. Nought spent and nobody having said what was
     * spent are different facts, and only one of them is a result.
     */
    const list = await (await admin.get('/api/retainers?limit=20')).json();
    let bare: { id: string; month: string } | null = null;
    for (const r of list.retainers ?? list.data ?? []) {
      const detail = await (await admin.get(`/api/retainers/${r.id}`)).json();
      for (const m of detail.retainer?.monthCards ?? []) {
        const card = await (await admin.get(`/api/retainers/${r.id}/month-cards/${m.month}`)).json();
        if (card.monthCard?.costBasis === 'none') {
          bare = { id: r.id, month: m.month };
          break;
        }
      }
      if (bare) break;
    }
    test.skip(!bare, 'every month in this database has costs against it');

    await page.goto(`/retainers/${bare!.id}?month=${bare!.month}`);
    await expect(page.getByText('Not known yet')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('100.0% margin')).toHaveCount(0);
  });
});
