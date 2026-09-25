import { test, expect, type Page } from '@playwright/test';
import { stateFor, apiAs } from './helpers';

/**
 * Editing a team member, and where departments come from.
 *
 * The member list offered access, kit, a password link and switching an account
 * off — and no way to change the person's own details. A misspelled name, or
 * somebody who changed theirs, stayed wrong for ever.
 *
 * Department was free text on every form that set it, so the same team ended up
 * spread across "Video & Production" and "Video / Production" with nothing to
 * stop a third spelling. It is a list on the organisation now, edited in
 * Settings rather than compiled in.
 */

type Person = { id: string; name: string; email?: string; preset?: string };

/*
 * `RowMenu` closes itself on any scroll, on purpose — it is positioned from the
 * trigger's own rect and would otherwise drift away from the row it belongs to.
 * Playwright scrolls the trigger into view before clicking it, and the browser
 * dispatches that scroll event a frame *after* the click lands, so the menu
 * opens and is immediately shut by the scroll that revealed it. A real person
 * scrolls and then clicks; only the robot does both at once. So: scroll first,
 * then open it until it stays open.
 */
async function openRowMenu(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: `Actions for ${name}` });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.scrollIntoViewIfNeeded();

  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Edit details' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  return page.getByRole('dialog', { name: new RegExp(`Edit ${name}`, 'i') });
}

test.describe('editing a team member', () => {
  test.use({ storageState: stateFor('admin') });

  test('is offered on each person, and edits their own details', async ({ page }) => {
    const api = await apiAs('admin');
    // `/api/users` answers with a bare array, and carries email/preset/dept
    // only for a caller with `work.team` — which the admin state has.
    const people: Person[] = await (await api.get('/api/users')).json();
    const subject = people.find((u) => u.preset === 'EMPLOYEE') ?? people[0];
    expect(subject, 'no team member to edit').toBeTruthy();

    await page.goto('/members');
    const modal = await openRowMenu(page, subject.name);
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Their own details — not their access, which is a separate decision made
    // by different people at different times.
    await expect(modal.getByLabel('Name')).toHaveValue(subject.name);
    await expect(modal.getByLabel('Email')).toHaveValue(subject.email ?? '');

    // Department is a list, not a text box: that is what stops one team being
    // three spellings.
    await expect(modal.getByRole('combobox', { name: 'Department' })).toBeVisible();

    try {
      await modal.getByLabel('Name').fill(`${subject.name} Kumar`);
      await modal.getByRole('button', { name: 'Save', exact: true }).click();

      await expect
        .poll(
          async () => {
            const after: Person[] = await (await api.get('/api/users')).json();
            return after.find((u) => u.id === subject.id)?.name ?? '';
          },
          { timeout: 15_000 },
        )
        .toBe(`${subject.name} Kumar`);
    } finally {
      await api.patch(`/api/users/${subject.id}`, { data: { name: subject.name } });
    }
  });

  test('offers the departments Settings holds, not a hardcoded list', async ({ page }) => {
    const api = await apiAs('admin');
    const cfg = await (await api.get('/api/config')).json();
    const departments: string[] = cfg.organization.departments ?? [];
    expect(departments.length).toBeGreaterThan(0);

    const people: Person[] = await (await api.get('/api/users')).json();
    const subject = people[0];

    await page.goto('/members');
    const modal = await openRowMenu(page, subject.name);
    await modal.getByRole('combobox', { name: 'Department' }).click();

    /*
     * Scoped to the open list. `Select` draws its options in a portal on
     * `body`, and the members page behind carries its own department filter —
     * so an unscoped `option` named "Accounts" finds that one too.
     */
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();

    // Every department the organisation holds is offered — same source, so the
    // form cannot drift from the setting.
    for (const d of departments.slice(0, 4)) {
      await expect(list.getByRole('option', { name: d, exact: true })).toBeVisible();
    }
  });

  test('takes a new department from Settings through to the form', async ({ page }) => {
    /*
     * The round trip, which is the whole point of the setting: type a
     * department on Settings, and it is what the edit form offers. A hardcoded
     * list passes the test above and fails this one.
     */
    const api = await apiAs('admin');
    const before: string[] = (await (await api.get('/api/config')).json()).organization.departments ?? [];
    const invented = 'Client Servicing (E2E-PROBE)';

    try {
      await page.goto('/settings');
      // Added one at a time — settings-lists.spec.ts covers the control itself.
      const add = page.getByLabel('Add a department');
      await expect(add).toBeVisible({ timeout: 20_000 });
      await add.fill(invented);
      await page.getByRole('button', { name: 'Add a department' }).click();
      await expect(page.getByRole('button', { name: `Remove ${invented}`, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

      const people: Person[] = await (await api.get('/api/users')).json();
      await page.goto('/members');
      const modal = await openRowMenu(page, people[0].name);
      await modal.getByRole('combobox', { name: 'Department' }).click();
      await expect(page.getByRole('listbox').getByRole('option', { name: invented, exact: true })).toBeVisible();
    } finally {
      await api.patch('/api/config', { data: { departments: before } });
    }
  });

  test('invites somebody into a department from the same list', async ({ page }) => {
    /*
     * The invite form is where people are created, so a text box here was the
     * one writing the new spellings — "Video & Production" beside "Video /
     * Production" started somewhere. It offers the organisation's list, the
     * same one Settings holds and the edit form shows.
     */
    const api = await apiAs('admin');
    const departments: string[] = (await (await api.get('/api/config')).json()).organization.departments ?? [];
    expect(departments.length).toBeGreaterThan(0);

    await page.goto('/members');
    await page.getByRole('button', { name: /Invite/ }).click();

    const modal = page.getByRole('dialog', { name: /Invite someone/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByRole('combobox', { name: 'Department' })).toBeVisible();
    // Not a box somebody types a fourteenth spelling into.
    await expect(modal.getByRole('textbox', { name: 'Department' })).toHaveCount(0);

    await modal.getByRole('combobox', { name: 'Department' }).click();
    const list = page.getByRole('listbox');
    for (const d of departments.slice(0, 3)) {
      await expect(list.getByRole('option', { name: d, exact: true })).toBeVisible();
    }
  });

  test('is not offered to somebody without admin access', async ({ browser }) => {
    // The server refuses a PATCH from anybody without `setup.admin`; the menu
    // must agree with it, or the product promises something it cannot do.
    const ctx = await browser.newContext({ storageState: stateFor('head') });
    const page = await ctx.newPage();
    const api = await apiAs('admin');
    const people: Person[] = await (await api.get('/api/users')).json();

    await page.goto('/members');
    const trigger = page.getByRole('button', { name: `Actions for ${people[0].name}` });
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.scrollIntoViewIfNeeded();
    await expect(async () => {
      await trigger.click();
      await expect(page.getByRole('menuitem', { name: 'Assign a task' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await expect(page.getByRole('menuitem', { name: 'Edit details' })).toHaveCount(0);
    await ctx.close();
  });
});
