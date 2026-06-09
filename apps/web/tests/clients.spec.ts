import { test, expect } from '@playwright/test';

const testEmail = `test-client-${Date.now()}@example.com`;
const password = 'Password123!';
const clientName = `Client ${Date.now()}`;

test.describe('Client Management Flow', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/register');
    await page.fill('input[placeholder="Your company name"]', 'Client Org');
    await page.fill('input[placeholder="John Doe"]', 'Client Admin');
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

  test('User can create a new client', async ({ page }) => {
    await page.click('a[href="/clients"]');
    await expect(page).toHaveURL(/.*\/clients/);

    await page.click('button:has-text("New Client")');

    // Validation check
    await page.click('button[type="submit"]', { force: true });
    await expect(page.locator('button:has-text("New Client")')).toBeVisible();

    await page.fill('input[name="name"]', clientName);
    await page.fill('input[name="industry"]', 'Finance');
    await page.click('button[type="submit"]', { force: true });

    // Should appear in list
    await expect(page.locator(`text=${clientName}`)).toBeVisible();
  });

  test('User can edit client details', async ({ page }) => {
    await page.click('a[href="/clients"]');
    await page.click(`text=${clientName}`);

    await expect(page).toHaveURL(/.*\/clients\/.+/);

    await page.click('button:has-text("Edit Client")');
    await page.fill('input[name="industry"]', 'Updated Industry');
    await page.click('button[type="submit"]', { force: true });

    await expect(page.locator('text=Updated Industry')).toBeVisible();
  });

  test('Internal Client Logic renders correctly', async ({ page }) => {
    await page.click('a[href="/clients"]');
    
    // The Internal client should always exist
    await page.click(`text=Client Org (Internal)`);
    await expect(page).toHaveURL(/.*\/clients\/.+/);

    // Should NOT have an edit client button
    await expect(page.locator('button:has-text("Edit Client")')).toBeHidden();

    // Should show Organization Profile section
    await expect(page.locator('text=Organization Profile')).toBeVisible();
  });
});
