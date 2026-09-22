import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiAs, stateFor, MARK } from './helpers';

/**
 * Who may put work on somebody else's plate.
 *
 * §9 separates two switches that look alike: `work.own` is "create my own
 * tasks", and `work.team` is "see and ASSIGN work for my people". Nothing
 * enforced the difference — POST /tasks asked only for work.own and took the
 * assignee list at face value — so anybody signed in could drop a task onto
 * anybody else's My Work and stamp a third person as the one who asked for it.
 *
 * That is not a data leak. It is worse in its way: the task lands looking
 * exactly like a real instruction, and the person it lands on has no reason to
 * doubt it.
 */

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let employee: APIRequestContext;
let head: APIRequestContext;
let people: { id: string; name: string; email: string }[] = [];

const idOf = (email: string) => people.find((p) => p.email === email)!.id;

test.beforeAll(async () => {
  admin = await apiAs('admin');
  employee = await apiAs('employee');
  head = await apiAs('head');
  const res = await admin.get('/api/users');
  const body = await res.json();
  people = Array.isArray(body) ? body : (body.users ?? body.data ?? []);
  expect(people.length, 'the seed has no people to assign between').toBeGreaterThan(1);
});

test.afterAll(async () => {
  // Through the database would be neater, but the purge teardown already
  // sweeps anything carrying the marker.
  await admin.dispose();
  await employee.dispose();
  await head.dispose();
});

const newTask = (ctx: APIRequestContext, body: Record<string, unknown>) =>
  ctx.post('/api/tasks', {
    data: { title: `${MARK} assignment ${Date.now()}`, workType: 'INTERNAL', dueDate: '2026-10-01', ...body },
  });

test.describe('the rule, on the server', () => {
  test('an employee may give themselves a task', async () => {
    const res = await newTask(employee, { assigneeIds: [idOf('ramya@eyelevelstudio.in')] });
    expect(res.status()).toBe(201);
  });

  test('an employee may not put one on somebody else', async () => {
    const res = await newTask(employee, { assigneeIds: [idOf('akmal@eyelevelstudio.in')] });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/only assign work to yourself/i);
  });

  test('naming yourself first does not make it your own work', async () => {
    // The half-way case, and the one a form would most easily produce.
    const res = await newTask(employee, {
      assigneeIds: [idOf('ramya@eyelevelstudio.in'), idOf('akmal@eyelevelstudio.in')],
    });
    expect(res.status()).toBe(403);
  });

  test('an employee may not name somebody else as the one who asked', async () => {
    /*
     * Separate from the assignee rule on purpose. Recording your manager as
     * the requester is writing down a conversation nobody can check, and
     * `assignedBy` is what the task shows as its authority.
     */
    const res = await newTask(employee, { assignedById: idOf('akmal@eyelevelstudio.in') });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/only record yourself/i);
  });

  test('a head may assign to several people at once', async () => {
    const res = await newTask(head, {
      assigneeIds: [idOf('ramya@eyelevelstudio.in'), idOf('akmal@eyelevelstudio.in')],
    });
    expect(res.status()).toBe(201);
    const task = (await res.json()).task;
    // Everybody on it, and the first is the lead — the one the load and the
    // overload alerts resolve to, so the order is not decoration.
    expect((task.assignees ?? []).length).toBe(2);
    expect(task.assignee?.id ?? task.assigneeId).toBe(idOf('ramya@eyelevelstudio.in'));
  });
});

test.describe('the rule, on the screen · as an employee', () => {
  test.use({ storageState: stateFor('employee') });

  test('gets a dialog that only makes work for themselves', async ({ page }) => {
    /*
     * My Work's own dialog is called "Task for myself" and has never had an
     * assignee picker — that part was already right. What it DID have was an
     * "Assigned by" picker offering the whole roster, so an employee could
     * record their manager as having asked for something. Naming a requester
     * is a work.team act, and the field is simply not there for them now.
     */
    // The screen opens its own dialog from this, which is steadier than
    // hunting for a button whose label is a single word.
    await page.goto('/my-work?create=true');

    // Still called what it is for them, because for them that is what it is.
    await expect(page.getByRole('dialog', { name: 'Task for myself' })).toBeVisible({ timeout: 15_000 });
    // Their own name, and no picker to be refused by on save.
    await expect(page.getByText(/Your own tasks are yours to make/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Assign to' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Assigned by' })).toHaveCount(0);
  });

  test('sees their own name where a form does offer an assignee', async ({ page }) => {
    /*
     * The quick-create panel has an assignee field for everybody. For somebody
     * who may only manage their own work it shows their name and no picker —
     * a disabled control listing fourteen names still says "you could choose
     * one of these", and the refusal would only arrive on save.
     */
    await page.goto('/my-work');
    await page.keyboard.press('Control+KeyK');
    const palette = page.getByPlaceholder(/search/i).first();
    await expect(palette).toBeVisible({ timeout: 15_000 });
    await palette.fill('task');

    const newTask = page.getByText(/New task/i).first();
    test.skip(!(await newTask.isVisible().catch(() => false)), 'the palette does not offer task creation here');
    await newTask.click();

    await expect(page.getByText(/Your own tasks are yours to make/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('the rule, on the screen · as a head', () => {
  test.use({ storageState: stateFor('head') });

  test('gets one box that takes several people', async ({ page }) => {
    const retainers = await (await head.get('/api/retainers?limit=10')).json();
    const live = (retainers.retainers ?? retainers.data ?? []).find((r: any) => r.status === 'ACTIVE');
    test.skip(!live, 'the seed has no active retainer to add a task to');

    await page.goto(`/retainers/${live.id}`);
    await page.getByRole('button', { name: 'Task', exact: true }).click();

    // The multi-select, not a single picker, and not the locked display.
    await expect(page.getByRole('combobox', { name: 'Assign to' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Your own tasks are yours to make/)).toHaveCount(0);
    await expect(page.getByLabel('Assigned by')).toBeVisible();
  });
});

// ── Every surface that can create or edit a task ────────────────────────────

test.describe('the flow reaches every task form', () => {
  test.use({ storageState: stateFor('admin') });

  /**
   * The list is derived, not remembered.
   *
   * There are five places a task can be created or edited, and the rule has to
   * be on all of them — a form that keeps its own picker is a form where an
   * employee gets the whole roster and a 403 on save. This reads the source
   * rather than trusting a list somebody wrote down, so a sixth form added
   * next month fails here instead of quietly opting out.
   */
  test('no task form keeps a picker of its own', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const roots = ['src/app', 'src/components'];
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) files.push(full);
      }
    };
    for (const r of roots) await walk(r);

    const offenders: string[] = [];
    for (const file of files) {
      const src = await fs.readFile(file, 'utf8');
      const touchesTasks = /api\.tasks\.(create|update)\(/.test(src);
      if (!touchesTasks) continue;

      // The shared field, or the one form whose assignee is fixed by context.
      const usesShared = /AssigneeField|AssignedByField/.test(src);
      const isNamedPersonForm = /AssignTaskModal/.test(path.basename(file));
      if (!usesShared && !isNamedPersonForm) offenders.push(`${file} — creates or edits a task with no shared assignee field`);

      /*
       * And nobody labels a picker of their own "Assign to" / "Assigned by".
       *
       * Deliberately narrow: `personOptions(team)` on its own is not a fault —
       * the Reviewer picker uses it too, and a reviewer is not an assignee. The
       * fault is a form owning one of the two labels the shared field owns,
       * because that is a control the permission rule does not reach.
       */
      const lines = src.split('\n');
      const ownAssigneeControl = lines.some((line, i) => {
        if (!/(label|ariaLabel)=["']Assign(ed)? (to|by)["']/.test(line)) return false;
        /*
         * Look at the opening tag, which is often a line or two above — a
         * multi-line <Row label="Assigned to" …> is the case that made a
         * single-line check report the read-only display as a control.
         */
        const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
        // Passing the label INTO the shared field is the point, not a fault.
        if (/AssigneeField|AssignedByField/.test(context)) return false;
        // A <Row> is a display, not a control — an employee should still be
        // able to SEE who a task is for and who asked for it.
        if (/<Row\b/.test(context)) return false;
        return true;
      });
      if (ownAssigneeControl && !isNamedPersonForm) {
        offenders.push(`${file} — labels an assignee control of its own instead of using the shared field`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('the edit drawer carries it too, not only the creation forms', async ({ page }) => {
    // Editing is where a task gets handed to the wrong person most often, and
    // it was the surface whose gate was a prop rather than a permission.
    const retainers = await (await admin.get('/api/retainers?limit=10')).json();
    const live = (retainers.retainers ?? retainers.data ?? []).find((r: any) => r.status === 'ACTIVE');
    test.skip(!live, 'the seed has no active retainer with tasks');

    /*
     * Through the project, because that is now the only way in.
     *
     * The retainer screen used to open on a flat list of the month's tasks;
     * it opens on its projects, and a task is something you reach by opening
     * the piece of work it belongs to. The default project is where the
     * monthly work lands, so it is the one guaranteed to have rows in it.
     */
    const projects = await (await admin.get(`/api/retainers/${live.id}/projects`)).json();
    const def = (projects.projects ?? []).find((p: any) => p.isDefault) ?? (projects.projects ?? [])[0];
    test.skip(!def, 'that retainer has no projects');
    await page.goto(`/retainers/${live.id}?project=${def.id}`);
    const firstTask = page.locator('tbody tr').first();
    test.skip(!(await firstTask.isVisible().catch(() => false)), 'that retainer has no ungrouped tasks');
    await firstTask.click();

    const edit = page.getByRole('button', { name: /^Edit$/ }).first();
    test.skip(!(await edit.isVisible().catch(() => false)), 'the drawer did not open on an editable task');
    await edit.click();

    await expect(page.getByRole('combobox', { name: 'Assigned to' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('combobox', { name: 'Assigned by' })).toBeVisible();
  });
});

test.describe('My Work’s own dialog · as a head', () => {
  test.use({ storageState: stateFor('head') });

  test('offers assignment, and stops calling itself a task for myself', async ({ page }) => {
    /*
     * The screenshot that started this. A head opening My Work's dialog saw a
     * picker for who ASKED for the work and none for who DOES it — which reads
     * backwards — and had to navigate to a project page to do the obvious
     * thing. The dialog's own name was the giveaway: it was written when
     * nobody could assign from anywhere.
     */
    await page.goto('/my-work?create=true');

    await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('combobox', { name: 'Assign to' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Assigned by' })).toBeVisible();
    await expect(page.getByText(/Your own tasks are yours to make/)).toHaveCount(0);
  });
});
