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
    await page.click('a[href="/projects"]');
    await expect(page).toHaveURL(/.*\/projects/);
    await page.click('button:has-text("New Project")');
    
    // Empty form validation
    await page.click('button[type="submit"]', { force: true });
    // Still in modal because validation failed
    await expect(page.locator('button:has-text("New Project")')).toBeVisible();

    await page.fill('input[name="name"]', projectName);
    await page.fill('textarea[name="description"]', 'A test project created by automated E2E tests.');
    await page.click('button[type="submit"]', { force: true });
    await expect(page.locator(`text=${projectName}`).first()).toBeVisible();
  });

  test('User can edit project details', async ({ page }) => {
    await page.click('a[href="/projects"]');
    await page.click(`text=${projectName}`);
    
    // Check we navigated to project details
    await expect(page).toHaveURL(/.*\/projects\/.+/);

    await page.click('button:has-text("Edit Project")');
    await page.fill('textarea[name="description"]', 'Updated description from E2E.');
    await page.click('button:has-text("Save Changes")');
    
    await expect(page.locator('text=Updated description from E2E.')).toBeVisible();
  });

  test('User can create milestones and tasks inside a project', async ({ page }) => {
    await page.click('a[href="/projects"]');
    await page.click(`text=${projectName}`);
    await expect(page).toHaveURL(/.*\/projects\/.+/);

    // Create Milestone
    await page.click('button:has-text("Add Milestone")');
    await page.fill('input[name="title"]', 'E2E Milestone');
    await page.click('button:has-text("Save Milestone")');
    
    // Should see milestone
    await expect(page.locator('text=E2E Milestone')).toBeVisible();

    // Create Task inside project
    await page.click('button:has-text("Add Task")');
    await page.fill('input[name="title"]', 'E2E Project Task');
    await page.click('button:has-text("Create Task")');

    // Should see task
    await expect(page.locator('text=E2E Project Task')).toBeVisible();
  });

  test('User can delete a project', async ({ page }) => {
    await page.click('a[href="/projects"]');
    await page.click(`text=${projectName}`);
    
    // Click Delete button on project details
    await page.click('button:has-text("Delete")');
    
    // Confirm delete dialog
    // The confirm dialog has a "Delete" confirm text
    await page.click('button:has-text("Delete"):not([class*="bg-red-50"])'); // The confirm button is usually red, but not the same class as the trigger

    // It redirects to projects page
    await expect(page).toHaveURL(/.*\/projects/);
    
    // The project should no longer be visible
    await expect(page.locator(`text=${projectName}`).first()).toBeHidden();
  });
});
