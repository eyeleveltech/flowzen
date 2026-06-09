import { test, expect } from '@playwright/test';

const testEmail = `test-team-${Date.now()}@example.com`;
const password = 'Password123!';
const teamName = `Team ${Date.now()}`;

test.describe('Team & Department Flow', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/register');
    await page.fill('input[placeholder="Your company name"]', 'Team Org');
    await page.fill('input[placeholder="John Doe"]', 'Team Admin');
    await page.fill('input[placeholder="you@company.com"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/dashboard/);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('User can create a new department', async ({ page }) => {
    await page.click('a[href="/teams"]');
    await expect(page).toHaveURL(/.*\/teams/);

    await page.click('button:has-text("Create Department")');

    // Form validation check
    await page.click('button[type="submit"]', { force: true });
    await expect(page.locator('button:has-text("Create Department")')).toBeVisible();

    await page.fill('input[name="name"]', teamName);
    await page.fill('textarea[name="description"]', 'Handles E2E tests');
    await page.click('button[type="submit"]', { force: true });

    // Should appear in list
    await expect(page.locator(`text=${teamName}`).first()).toBeVisible();
  });

  test('User can edit a department', async ({ page }) => {
    await page.click('a[href="/teams"]');
    
    // Depending on UI, we might click the team name or an edit icon
    // Assuming clicking the team card opens details or edit modal
    await page.click(`text=${teamName}`);

    // If it opens a page or modal
    await page.click('button:has-text("Edit Department")');
    await page.fill('input[name="name"]', `${teamName} Updated`);
    await page.click('button[type="submit"]', { force: true });

    await expect(page.locator(`text=${teamName} Updated`).first()).toBeVisible();
  });

  test('User can delete a department', async ({ page }) => {
    await page.click('a[href="/teams"]');
    await page.click(`text=${teamName} Updated`);

    await page.click('button:has-text("Delete")');
    
    // Confirm delete
    await page.click('button:has-text("Delete"):not([class*="bg-red-50"])'); 

    // Should be removed
    await expect(page.locator(`text=${teamName} Updated`).first()).toBeHidden();
  });
});
