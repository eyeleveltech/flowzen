import { test, expect } from '@playwright/test';

const testEmail = `test-admin-${Date.now()}@example.com`;
const password = 'Password123!';

test.describe('Settings & Automations Flow', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/register');
    await page.fill('input[placeholder="Your company name"]', 'Settings Org');
    await page.fill('input[placeholder="John Doe"]', 'Settings Admin');
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

  test('User can update Organization Profile', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await expect(page).toHaveURL(/.*\/settings/);

    // Click Organization tab (if not already selected)
    await page.click('button:has-text("Organization")');

    // Update settings
    await page.fill('input[placeholder="e.g. Technology, Healthcare"]', 'Tech Company');
    await page.fill('input[placeholder="e.g. +1 (555) 000-0000"]', '1234567890');
    
    // Save
    await page.click('button:has-text("Save Organization Profile")');
    
    // Should see success toast
    await expect(page.locator('text=Organization profile updated')).toBeVisible();
  });

  test('User can use Invite User Modal', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await page.click('button:has-text("Users & Roles")');

    await page.click('button:has-text("Invite Member")');
    
    // Form validation
    await page.click('button:has-text("Send Invitation")');
    await expect(page.locator('button:has-text("Send Invitation")')).toBeVisible();

    await page.fill('input[type="email"]', 'new-member@example.com');
    // Assuming Select role works via native select or we just leave default
    await page.click('button:has-text("Send Invitation")');

    // Should see success
    await expect(page.locator('text=Invitation sent')).toBeVisible();
  });

  test('User can create Project Templates', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await page.click('button:has-text("Templates")');

    await page.click('button:has-text("Create Template")');
    await page.fill('input[name="name"]', 'E2E Template');
    await page.fill('textarea[name="description"]', 'E2E test template');
    await page.click('button:has-text("Save Template")');

    await expect(page.locator('text=E2E Template')).toBeVisible();
  });

  test('User can create and delete Workflow Automations', async ({ page }) => {
    await page.click('a[href="/settings"]');
    await page.click('button:has-text("Automations")');

    await page.click('button:has-text("Create Workflow")');
    await page.fill('input[name="name"]', 'E2E Rule');
    
    // Choose conditions
    await page.selectOption('select[name="triggerType"]', 'TASK_CREATED');
    await page.selectOption('select[name="actionType"]', 'NOTIFY_USER');

    await page.click('button:has-text("Save Workflow")');

    // Should see the new rule
    await expect(page.locator('text=E2E Rule')).toBeVisible();

    // Delete rule
    await page.click('button:has-text("Delete"):not([class*="bg-red-50"])');
    // Confirm delete if modal exists, or it just deletes
    await expect(page.locator('text=E2E Rule')).toBeHidden();
  });
});
