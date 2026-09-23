import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor } from './helpers';

/**
 * A one-off project's task list.
 *
 * It was a two-line list item — the title, then "Janani · due 20 Sept" in
 * small grey — while the same work inside a retainer got a proper table. So
 * the two questions you actually ask of a task list, who has it and what is
 * late, could not be scanned down a column on one screen and could on the
 * other. Priority was a dot drawn only for High and Urgent, which left Medium
 * and Low looking like no answer rather than an answer.
 *
 * The columns here are the retainer project page's, deliberately: the same
 * kind of thing should read the same way wherever it is listed.
 */

let admin: APIRequestContext;
let projectId = '';

test.beforeAll(async () => {
  admin = await apiAs('admin');
  const res = await (await admin.get('/api/projects?limit=20')).json();
  const withTasks = (res.projects ?? res.data ?? []).find((p: any) => (p.openTasks ?? 0) > 0);
  projectId = (withTasks ?? (res.projects ?? [])[0])?.id ?? '';
});

test.afterAll(async () => {
  await admin.dispose();
});

test.describe('a project lists its tasks in columns', () => {
  test.use({ storageState: stateFor('admin') });

  test('the same columns a retainer project uses', async ({ page }) => {
    test.skip(!projectId, 'no project in this database');
    await page.goto(`/projects/${projectId}?tab=tasks`);

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15_000 });

    for (const heading of ['Task', 'Assigned to', 'Assigned', 'Due', 'Priority', 'Status']) {
      await expect(table.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
  });

  test('every task says its priority, not only the urgent ones', async ({ page }) => {
    test.skip(!projectId, 'no project in this database');
    await page.goto(`/projects/${projectId}?tab=tasks`);

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // The priority cell is the fifth column and is never blank — a task with
    // no stated priority still reads "Medium", which is what it is.
    for (const row of await rows.all()) {
      await expect(row.locator('td').nth(4)).toHaveText(/Low|Medium|High|Urgent/);
    }
  });
});

/**
 * Narrowing a project's tasks.
 *
 * The same control, vocabulary and helpers as a retainer project's list —
 * `TASK_FILTER_OPTIONS` and `matchesStatusFilter` are shared between the two
 * screens, so "Open" cannot come to mean one thing here and another there.
 */
test.describe('narrowing a project', () => {
  test.use({ storageState: stateFor('admin') });

  test('nothing selected hides nothing', async ({ page }) => {
    test.skip(!projectId, 'no project in this database');
    await page.goto(`/projects/${projectId}?tab=tasks`);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    const status = page.getByRole('combobox', { name: 'Filter by status' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('Any status');
  });

  test('picking Done leaves only finished work', async ({ page }) => {
    test.skip(!projectId, 'no project in this database');
    await page.goto(`/projects/${projectId}?tab=tasks`);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('combobox', { name: 'Filter by status' }).click();
    await page.getByRole('option', { name: 'Done' }).click();
    await page.keyboard.press('Escape');

    const rows = page.locator('tbody tr');
    // Either every remaining row is done, or the list says nothing matched.
    if (await rows.count()) {
      for (const row of await rows.all()) {
        await expect(row.locator('td').nth(5)).toContainText('Done');
      }
    } else {
      await expect(page.getByText(/Nothing matches that/)).toBeVisible();
    }
  });
});
