import { test, expect } from '@playwright/test';
import { stateFor, apiAs } from './helpers';

/**
 * What /profile says about who you are.
 *
 * The one line the page carried about that was "Level: Super Admin" — a value
 * of a generic ladder (MEMBER → SUPER_ADMIN) nobody at this agency uses,
 * derived from the access preset and printed where a person reads their job.
 * The two are different facts and come apart in practice: a developer holding
 * MANAGEMENT access read that he was a Super Admin of a company with no such
 * title, and his real job — Developer, in Development — appeared nowhere.
 *
 * So the job leads (job title · department, beside the name) and access is its
 * own line, in this agency's words. `web/src/lib/people.ts` sets out the four
 * fields; this holds the screen to them.
 */

type Profile = { name: string; designation: string | null; dept: string | null; preset: string | null };

test.describe('your profile', () => {
  test.use({ storageState: stateFor('admin') });

  test('leads with the job, and names access as access', async ({ browser }) => {
    // The employee persona is the clean contrast: designation "Designer",
    // department "Design", access EMPLOYEE. Three different words, from three
    // different fields.
    const api = await apiAs('employee');
    const me: Profile = await (await api.get('/api/profile')).json();
    expect(me.designation, 'the seeded employee has no job title to show').toBeTruthy();

    const ctx = await browser.newContext({ storageState: stateFor('employee') });
    const own = await ctx.newPage();
    await own.goto('/profile');
    await expect(own.getByRole('heading', { name: 'Your profile' })).toBeVisible({ timeout: 20_000 });

    // The job, beside the name.
    await expect(own.getByText(`${me.designation} · ${me.dept}`)).toBeVisible();
    // And editable, because what you are called is yours to correct.
    await expect(own.getByLabel('Job title')).toHaveValue(me.designation!);

    // The department, which an admin sets — read out, not offered.
    const account = own.locator('dl').filter({ hasText: 'App access' });
    await expect(account).toContainText(me.dept!);
    await expect(account).toContainText('Employee');

    // The ladder is gone, not relabelled.
    await expect(own.locator('body')).not.toContainText('Super Admin');
    await expect(own.getByText('Level', { exact: true })).toHaveCount(0);
    await ctx.close();
  });

  test('does not print the access level as the job title', async ({ page }) => {
    /*
     * The case that started this: whoever holds MANAGEMENT access still has
     * their own job. Access says "Management"; the job line is read from
     * `designation`, so setting one does not change the other.
     */
    const api = await apiAs('admin');
    const before: Profile = await (await api.get('/api/profile')).json();

    try {
      await api.patch('/api/profile', { data: { designation: 'Developer' } });

      await page.goto('/profile');
      await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible({ timeout: 20_000 });

      await expect(page.getByLabel('Job title')).toHaveValue('Developer');
      const account = page.locator('dl').filter({ hasText: 'App access' });
      await expect(account).toContainText('Management');
      await expect(page.locator('body')).not.toContainText('Super Admin');
    } finally {
      await api.patch('/api/profile', { data: { designation: before.designation } });
    }
  });
});
