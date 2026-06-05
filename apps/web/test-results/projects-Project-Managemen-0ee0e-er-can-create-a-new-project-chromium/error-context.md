# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: projects.spec.ts >> Project Management Flow >> User can create a new project
- Location: tests\projects.spec.ts:31:7

# Error details

```
"beforeAll" hook timeout of 60000ms exceeded.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | // Use a unique email for each run to avoid collision
  4  | const testEmail = `test-pm-${Date.now()}@example.com`;
  5  | const password = 'Password123!';
  6  | const projectName = `Test Project ${Date.now()}`;
  7  | 
  8  | test.describe('Project Management Flow', () => {
  9  |   // Before all tests, register a new user so we have a fresh workspace
> 10 |   test.beforeAll(async ({ browser }) => {
     |        ^ "beforeAll" hook timeout of 60000ms exceeded.
  11 |     const page = await browser.newPage();
  12 |     await page.goto('/register');
  13 |     await page.fill('input[placeholder="Your company name"]', 'Project Org');
  14 |     await page.fill('input[placeholder="John Doe"]', 'PM User');
  15 |     await page.fill('input[placeholder="you@company.com"]', testEmail);
  16 |     await page.fill('input[type="password"]', password);
  17 |     await page.click('button[type="submit"]', { force: true });
  18 |     await expect(page).toHaveURL(/.*\/dashboard/);
  19 |     await page.close();
  20 |   });
  21 | 
  22 |   test.beforeEach(async ({ page }) => {
  23 |     // Login before each test
  24 |     await page.goto('/login');
  25 |     await page.fill('input[type="email"]', testEmail);
  26 |     await page.fill('input[type="password"]', password);
  27 |     await page.click('button[type="submit"]', { force: true });
  28 |     await expect(page).toHaveURL(/.*\/dashboard/);
  29 |   });
  30 | 
  31 |   test('User can create a new project', async ({ page }) => {
  32 |     // Navigate to projects page
  33 |     await page.click('a[href="/projects"]');
  34 |     await expect(page).toHaveURL(/.*\/projects/);
  35 | 
  36 |     // Click "New Project" button
  37 |     await page.click('button:has-text("New Project")');
  38 | 
  39 |     // Fill in project details
  40 |     await page.fill('input[name="name"]', projectName);
  41 |     await page.fill('textarea[name="description"]', 'A test project created by automated E2E tests.');
  42 |     
  43 |     // Select a client if there's a client dropdown, or create without it
  44 |     // Wait for the modal submit button
  45 |     await page.click('button[type="submit"]', { force: true });
  46 | 
  47 |     // Should appear in the projects list
  48 |     await expect(page.locator(`text=${projectName}`)).toBeVisible();
  49 |   });
  50 | });
  51 | 
```