import { test, expect } from '@playwright/test';

// Use a unique email for each run to avoid collision
const testEmail = `test-pm-${Date.now()}@example.com`;
const password = 'Password123!';
const projectName = `Test Project ${Date.now()}`;

test.describe('Project Management Flow', () => {
  // Before all tests, register a new user so we have a fresh workspace
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/register');
    await page.fill('input[placeholder="Your company name"]', 'Project Org');
    await page.fill('input[placeholder="John Doe"]', 'PM User');
    await page.fill('input[placeholder="you@company.com"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/dashboard/);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('User can create a new project', async ({ page }) => {
    // Navigate to projects page
    await page.click('a[href="/projects"]');
    await expect(page).toHaveURL(/.*\/projects/);

    // Click "New Project" button
    await page.click('button:has-text("New Project")');

    // Fill in project details
    await page.fill('input[name="name"]', projectName);
    await page.fill('textarea[name="description"]', 'A test project created by automated E2E tests.');
    
    // Select a client if there's a client dropdown, or create without it
    // Wait for the modal submit button
    await page.click('button[type="submit"]', { force: true });

    // Should appear in the projects list
    await expect(page.locator(`text=${projectName}`)).toBeVisible();
  });
});
