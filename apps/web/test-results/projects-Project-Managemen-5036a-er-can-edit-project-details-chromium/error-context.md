# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: projects.spec.ts >> Project Management Flow >> User can edit project details
- Location: tests\projects.spec.ts:47:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/register
Call log:
  - navigating to "http://localhost:3000/register", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | // Use a unique email for each run to avoid collision
  4   | const testEmail = `test-pm-${Date.now()}@example.com`;
  5   | const password = 'Password123!';
  6   | const projectName = `Test Project ${Date.now()}`;
  7   | 
  8   | test.describe('Project Management Flow', () => {
  9   |   // Before all tests, register a new user so we have a fresh workspace
  10  |   test.beforeAll(async ({ browser }) => {
  11  |     const page = await browser.newPage();
> 12  |     await page.goto('/register');
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/register
  13  |     await page.fill('input[placeholder="Your company name"]', 'Project Org');
  14  |     await page.fill('input[placeholder="John Doe"]', 'PM User');
  15  |     await page.fill('input[placeholder="you@company.com"]', testEmail);
  16  |     await page.fill('input[type="password"]', password);
  17  |     await page.click('button[type="submit"]', { force: true });
  18  |     await expect(page).toHaveURL(/.*\/dashboard/);
  19  |     await page.close();
  20  |   });
  21  | 
  22  |   test.beforeEach(async ({ page }) => {
  23  |     // Login before each test
  24  |     await page.goto('/login');
  25  |     await page.fill('input[type="email"]', testEmail);
  26  |     await page.fill('input[type="password"]', password);
  27  |     await page.click('button[type="submit"]', { force: true });
  28  |     await expect(page).toHaveURL(/.*\/dashboard/);
  29  |   });
  30  | 
  31  |   test('User can create a new project', async ({ page }) => {
  32  |     await page.click('a[href="/projects"]');
  33  |     await expect(page).toHaveURL(/.*\/projects/);
  34  |     await page.click('button:has-text("New Project")');
  35  |     
  36  |     // Empty form validation
  37  |     await page.click('button[type="submit"]', { force: true });
  38  |     // Still in modal because validation failed
  39  |     await expect(page.locator('button:has-text("New Project")')).toBeVisible();
  40  | 
  41  |     await page.fill('input[name="name"]', projectName);
  42  |     await page.fill('textarea[name="description"]', 'A test project created by automated E2E tests.');
  43  |     await page.click('button[type="submit"]', { force: true });
  44  |     await expect(page.locator(`text=${projectName}`).first()).toBeVisible();
  45  |   });
  46  | 
  47  |   test('User can edit project details', async ({ page }) => {
  48  |     await page.click('a[href="/projects"]');
  49  |     await page.click(`text=${projectName}`);
  50  |     
  51  |     // Check we navigated to project details
  52  |     await expect(page).toHaveURL(/.*\/projects\/.+/);
  53  | 
  54  |     await page.click('button:has-text("Edit Project")');
  55  |     await page.fill('textarea[name="description"]', 'Updated description from E2E.');
  56  |     await page.click('button:has-text("Save Changes")');
  57  |     
  58  |     await expect(page.locator('text=Updated description from E2E.')).toBeVisible();
  59  |   });
  60  | 
  61  |   test('User can create milestones and tasks inside a project', async ({ page }) => {
  62  |     await page.click('a[href="/projects"]');
  63  |     await page.click(`text=${projectName}`);
  64  |     await expect(page).toHaveURL(/.*\/projects\/.+/);
  65  | 
  66  |     // Create Milestone
  67  |     await page.click('button:has-text("Add Milestone")');
  68  |     await page.fill('input[name="title"]', 'E2E Milestone');
  69  |     await page.click('button:has-text("Save Milestone")');
  70  |     
  71  |     // Should see milestone
  72  |     await expect(page.locator('text=E2E Milestone')).toBeVisible();
  73  | 
  74  |     // Create Task inside project
  75  |     await page.click('button:has-text("Add Task")');
  76  |     await page.fill('input[name="title"]', 'E2E Project Task');
  77  |     await page.click('button:has-text("Create Task")');
  78  | 
  79  |     // Should see task
  80  |     await expect(page.locator('text=E2E Project Task')).toBeVisible();
  81  |   });
  82  | 
  83  |   test('User can delete a project', async ({ page }) => {
  84  |     await page.click('a[href="/projects"]');
  85  |     await page.click(`text=${projectName}`);
  86  |     
  87  |     // Click Delete button on project details
  88  |     await page.click('button:has-text("Delete")');
  89  |     
  90  |     // Confirm delete dialog
  91  |     // The confirm dialog has a "Delete" confirm text
  92  |     await page.click('button:has-text("Delete"):not([class*="bg-red-50"])'); // The confirm button is usually red, but not the same class as the trigger
  93  | 
  94  |     // It redirects to projects page
  95  |     await expect(page).toHaveURL(/.*\/projects/);
  96  |     
  97  |     // The project should no longer be visible
  98  |     await expect(page.locator(`text=${projectName}`).first()).toBeHidden();
  99  |   });
  100 | });
  101 | 
```