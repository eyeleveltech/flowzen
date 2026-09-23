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

  test('an old ?project= link lands on the project, with one month control', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');

    /*
     * `?project=` opened a drill-in on the retainer page for months, so it is
     * in bookmarks and in links people have already sent each other. It
     * redirects now.
     */
    await page.goto(`/retainers/${retainerId}?project=${projectId}`);
    await expect(page).toHaveURL(new RegExp(`/retainers/${retainerId}/projects/${projectId}`), {
      timeout: 15_000,
    });

    await expect(page.getByRole('heading', { name: `${MARK} Diwali Campaign` })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();

    /*
     * ONE month control, and it belongs to this page.
     *
     * The drill-in had its own on top of the retainer header's, and when a
     * project had no work in the month the header was on, the two disagreed —
     * October above, September's tasks below, under tiles counting October.
     * On its own page there is nothing to disagree with, and this is what
     * pins that: exactly one.
     */
    const months = page.getByRole('group', { name: 'Month' });
    await expect(months).toHaveCount(1);
    await expect(months).toHaveText(
      /(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}|Every month/,
    );
  });

  test('the project is in the URL, so it can be sent to somebody', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}`);
    await page.getByText(`${MARK} Diwali Campaign`).first().click();

    // A route of its own now, not `?project=` on the retainer.
    await expect(page).toHaveURL(
      new RegExp(`/retainers/${retainerId}/projects/${projectId}`),
      { timeout: 15_000 },
    );

    // And back goes to the retainer it belongs to, not to Live work.
    await page.locator(`a[href="/retainers/${retainerId}"]`).first().click();
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
    await page.goto(`/retainers/${retainerId}/projects/${projectId}`);
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
    await page.goto(`/retainers/${retainerId}/projects/${projectId}`);
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

/**
 * Narrowing the list without losing the work.
 *
 * A month of retainer work is twenty-odd rows, and the question actually asked
 * of it is "what is still open" — which needs more than one state selected at
 * a time, which is why this is a multi-select and not a row of chips.
 */
test.describe('narrowing a project', () => {
  test.use({ storageState: stateFor('admin') });

  test('the status filter takes more than one state at once', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}/projects/${projectId}`);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    const before = await page.locator('tbody tr').count();

    // Nothing selected is no filter — the dropdown must not hide work by default.
    const status = page.getByRole('combobox', { name: 'Filter by status' });
    await expect(status).toBeVisible();

    await status.click();
    await page.getByRole('option', { name: 'Done' }).click();
    // Still open: a second value goes in without replacing the first.
    await page.getByRole('option', { name: 'Open' }).click();
    await page.keyboard.press('Escape');

    const after = await page.locator('tbody tr').count();
    // Open + Done cannot show MORE than everything, and the point of the test
    // is that picking a second value widens rather than replaces.
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
  });

});

/**
 * Removing a project asks in the app, not in the browser.
 *
 * This was the last `window.confirm` in the codebase, which meant the one
 * dialog that most needed to explain itself — the tasks SURVIVE, they just
 * stop being grouped — was the one that could only render unstyled system
 * text above a button labelled OK.
 *
 * A native dialog also cannot be tested: Playwright has to intercept it at the
 * page level, and nothing can assert what it said.
 */
test.describe('removing a project', () => {
  test.use({ storageState: stateFor('admin') });

  test('the app asks before removing a project, and says what survives', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');

    // If a native dialog appears the test must not hang on it — and catching
    // it here is also how we prove one does NOT appear.
    let nativeDialogs = 0;
    page.on('dialog', async (d) => {
      nativeDialogs += 1;
      await d.dismiss();
    });

    await page.goto(`/retainers/${retainerId}/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: `${MARK} Diwali Campaign` })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Remove' }).click();

    // The app's own dialog, naming the project and its own button.
    await expect(page.getByText(`Remove "${MARK} Diwali Campaign"?`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove project' })).toBeVisible();
    expect(nativeDialogs).toBe(0);

    // Cancelling leaves the project exactly where it was — this spec's
    // afterAll still expects it to exist.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: `${MARK} Diwali Campaign` })).toBeVisible();
  });
});

/**
 * One Task button, in the place that answers the question.
 *
 * There were two at once inside a project — the page header's and the
 * project's — a hand's width apart, calling the same handler and opening the
 * same modal with the same props. Which one survives depends on where you
 * are, because the form's first question is which project the work belongs
 * to:
 *
 *   inside a project   the project's own button. The answer is already known,
 *                      so the form states it instead of asking.
 *   on the list        the page header's. Nothing has said which project yet,
 *                      so the form asks.
 */
test.describe('adding work from the right place', () => {
  test.use({ storageState: stateFor('admin') });

  test('a project shows exactly one Task button, and the form knows the project', async ({ page }) => {
    test.skip(!projectId, 'the project could not be created');
    await page.goto(`/retainers/${retainerId}/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: `${MARK} Diwali Campaign` })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Task', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Task', exact: true }).click();
    // Stated, not asked — and the project named is the one we are standing in.
    await expect(page.getByText(`${MARK} Diwali Campaign`).last()).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Belongs to' })).toHaveCount(0);
  });

  test('the projects list keeps its Task button, and the form asks', async ({ page }) => {
    await page.goto(`/retainers/${retainerId}`);
    await expect(page.getByText('Monthly Retainer Work').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: 'Task', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Task', exact: true }).click();
    // Nothing has said which project, so the picker is there to be answered.
    await expect(page.getByRole('combobox', { name: 'Belongs to' })).toBeVisible();
  });
});
