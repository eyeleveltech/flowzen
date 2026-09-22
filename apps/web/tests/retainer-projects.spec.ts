import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor, MARK } from './helpers';

/**
 * Projects are the way into a retainer, and tasks live inside them.
 *
 * The screen used to open on a flat list of the month's tasks — thirty rows
 * with no shape, which is the problem retainer projects were added to solve
 * and then did not, because the list was still the first thing and the
 * grouping was a heading inside it.
 *
 * Two things this has to get right, and both are easy to get wrong:
 *
 *   1. There is no ungrouped retainer work. A task on a month card names a
 *      project — a CHECK constraint enforces it — which is only survivable
 *      because every retainer is created with a default that catches the
 *      monthly baseline. Deleting that default is refused.
 *   2. Opening a project shows its tasks across EVERY month it touches.
 *      Scoping that to the month in the header would put a campaign crossing
 *      October into November back into the two piles it exists to join.
 */

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let retainerId = '';
/** A project created by this spec, removed at the end. */
let projectId = '';
/** Tasks this spec filed under it, put back afterwards. */
const filed: string[] = [];

test.beforeAll(async () => {
  admin = await apiAs('admin');
  const list = await (await admin.get('/api/retainers?limit=20')).json();
  const live = (list.retainers ?? list.data ?? []).find((r: any) => r.status === 'ACTIVE');
  if (!live) return;
  retainerId = live.id;

  const made = await admin.post(`/api/retainers/${retainerId}/projects`, {
    data: { name: `${MARK} Diwali Campaign`, startDate: '2026-08-20', endDate: '2026-11-10' },
  });
  projectId = (await made.json()).project?.id ?? '';

  // One task from each month this retainer has, so the drill-in has something
  // to prove about crossing a month boundary. A closed month refuses an edit,
  // so only the open ones can be filed — which is itself the right behaviour.
  // Taken from the retainer's default, which is where the seeded monthly work
  // now lives — there is no ungrouped pile to draw from any more.
  const owned = await (await admin.get(`/api/retainers/${retainerId}/projects`)).json();
  const def = (owned.projects ?? []).find((p: any) => p.isDefault);
  const source = def
    ? await (await admin.get(`/api/retainers/${retainerId}/projects/${def.id}/tasks`)).json()
    : { months: [] };
  for (const group of source.months ?? []) {
    if (group.status === 'CLOSED') continue;
    const t = group.tasks[0];
    if (!t) continue;
    const res = await admin.patch(`/api/tasks/${t.id}`, { data: { retainerProjectId: projectId } });
    if (res.ok()) filed.push(t.id);
  }
});

test.afterAll(async () => {
  // Put the tasks back where they came from. Deleting the project would move
  // them to the default anyway, but being explicit means a half-failed run
  // still leaves the seed as it found it.
  const owned = await (await admin.get(`/api/retainers/${retainerId}/projects`)).json();
  const def = (owned.projects ?? []).find((p: any) => p.isDefault);
  if (def) for (const id of filed) await admin.patch(`/api/tasks/${id}`, { data: { retainerProjectId: def.id } });
  if (projectId) await admin.delete(`/api/retainers/${retainerId}/projects/${projectId}`);
  await admin.dispose();
});

test.describe('the way in', () => {
  test.use({ storageState: stateFor('admin') });

  test('a retainer opens on its projects, not on a list of tasks', async ({ page }) => {
    test.skip(!retainerId, 'no active retainer in this database');
    await page.goto(`/retainers/${retainerId}`);

    // Projects is the tab you land on, and it is first.
    await expect(page.getByRole('tab', { name: /^Projects/ })).toHaveAttribute('aria-selected', 'true', {
      timeout: 15_000,
    });
    // The flat month-wide task list is gone: there is no Tasks tab to open.
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveCount(0);
  });

  test('there is no ungrouped work to offer', async ({ page }) => {
    /*
     * A task on a month card names a project — a CHECK constraint enforces it —
     * so the "Not in a project" card has nothing to hold and is gone. Every
     * retainer is created with a default that catches the monthly baseline,
     * which is what makes that rule survivable.
     */
    test.skip(!retainerId, 'no active retainer in this database');
    await page.goto(`/retainers/${retainerId}`);

    await expect(page.getByText('Monthly Retainer Work').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Not in a project')).toHaveCount(0);
  });

  test('the retainer default cannot be removed', async ({ page }) => {
    // Deleting it would leave the next 1st-of-month roll with nowhere to put
    // the template's work, and every task on it in a state the CHECK forbids.
    test.skip(!retainerId, 'no active retainer in this database');
    const list = await (await admin.get(`/api/retainers/${retainerId}/projects`)).json();
    const def = (list.projects ?? []).find((p: any) => p.isDefault);
    test.skip(!def, 'this retainer has no default project');

    const res = await admin.delete(`/api/retainers/${retainerId}/projects/${def.id}`);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be removed/i);
  });

  test('opening one shows its tasks, and says which month bills each', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}?project=${projectId}`);

    await expect(page.getByRole('heading', { name: `${MARK} Diwali Campaign` })).toBeVisible({ timeout: 15_000 });
    // A month heading, not a bare table — the month is which card the task's
    // cost lands on, and a closed one must not be offered for editing.
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.getByText(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/).first()).toBeVisible();
  });

  test('the project is in the URL, so it can be sent to somebody', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}`);
    await page.getByText(`${MARK} Diwali Campaign`).first().click();
    await expect(page).toHaveURL(new RegExp(`project=${projectId}`), { timeout: 15_000 });

    // And going back closes the project rather than leaving the retainer.
    await page.getByRole('button', { name: /All projects/ }).click();
    await expect(page.getByText('Monthly Retainer Work').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('adding a task from inside a project', () => {
  test.use({ storageState: stateFor('admin') });

  test('states the project instead of asking for a retainer', async ({ page }) => {
    /*
     * It asked twice and got it backwards. "Belongs to" offered every month
     * card and every one-off project of the company and defaulted to
     * "Retainer — 2026-09"; a second field underneath then asked which
     * project. So standing inside the Diwali campaign, the first and larger
     * control said Retainer and invited you to change it.
     */
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}?project=${projectId}`);
    await page.getByRole('button', { name: 'Task', exact: true }).first().click();

    await expect(page.getByText(`${MARK} Diwali Campaign`).last()).toBeVisible({ timeout: 15_000 });
    // Neither question is asked, because the screen already answered both.
    await expect(page.getByRole('combobox', { name: 'Belongs to' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Project' })).toHaveCount(0);
    // The month is still stated, because it is what decides which card the
    // task's cost and profit land on.
    await expect(page.getByText(/Billed on \w+ \d{4}/)).toBeVisible();
  });

  test('still asks when the answer is a real question', async ({ page }) => {
    // From the ungrouped work there is no project in context, so both pickers
    // belong — removing them everywhere would be the opposite mistake.
    test.skip(!retainerId, 'no active retainer in this database');
    // From the retainer header rather than from inside a project, where the
    // screen has not already answered which piece of work this is for.
    await page.goto(`/retainers/${retainerId}`);
    await page.getByRole('button', { name: 'Task', exact: true }).first().click();

    await expect(page.getByRole('combobox', { name: 'Belongs to' })).toBeVisible({ timeout: 15_000 });
  });

  test('the drawer names the project a task is part of', async ({ page }) => {
    /*
     * It said "Work: September 2026 retainer" and stopped — so a task opened
     * from inside a campaign named the retainer and never the campaign, which
     * is the thing you were looking at.
     */
    test.skip(filed.length === 0, 'no task could be filed under the project');
    await page.goto(`/retainers/${retainerId}?project=${projectId}`);
    await page.locator('tbody tr').first().click();

    // `exact`, because a bare "Work" also matches the My Work and Live work
    // links in the sidebar behind the drawer.
    await expect(page.getByText('Work', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('September 2026 retainer')).toBeVisible();
    // And the campaign, as a link back to it.
    await expect(page.getByRole('link', { name: `${MARK} Diwali Campaign` })).toBeVisible();
  });
});

test.describe('the Live work list', () => {
  test.use({ storageState: stateFor('admin') });

  test('says what each retainer is, not just how busy its month is', async ({ page }) => {
    /*
     * The only column about the work was the month's task count. Every row on
     * a six-retainer page read "1 of 5 tasks done" — true, identical, and
     * silent about what any of them are actually for.
     */
    test.skip(!projectId, 'the project could not be created');
    await page.goto('/live-work');

    await expect(page.getByRole('columnheader', { name: 'Projects' })).toBeVisible({ timeout: 15_000 });
    // The campaign this spec created, named in the row rather than counted.
    await expect(page.getByText(`${MARK} Diwali Campaign`).first()).toBeVisible();
  });

  test('draws a progress bar you can actually read', async ({ page }) => {
    /*
     * The track was `bg-line2` — a class used in this one place and defined
     * nowhere. It resolved to nothing, so every bar was a floating dash with
     * no track behind it, and a bar with no track cannot show 20% apart from
     * 80%, which is the only thing a bar is for.
     */
    await page.goto('/live-work');
    const bar = page.getByRole('progressbar').first();
    await expect(bar).toBeVisible({ timeout: 15_000 });
    const track = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(track).not.toBe('rgba(0, 0, 0, 0)');
    expect(track).not.toBe('transparent');
  });
});

test.describe('a month with no card', () => {
  test.use({ storageState: stateFor('admin') });

  test('still lets you see and add projects', async ({ page }) => {
    /*
     * Projects belong to the retainer, not to a month. They used to vanish
     * entirely on a month the roll had not reached, so there was no month from
     * which a campaign could be set up before it started.
     */
    test.skip(!retainerId, 'no active retainer in this database');
    const far = '2027-12';
    await page.goto(`/retainers/${retainerId}?month=${far}`);

    await expect(page.getByRole('button', { name: /^Project$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Monthly Retainer Work').first()).toBeVisible();
    // The billing side still says there is nothing for that month.
    await page.getByRole('tab', { name: /^Costs/ }).click();
    await expect(page.getByText('No month card here')).toBeVisible({ timeout: 15_000 });
  });
});
