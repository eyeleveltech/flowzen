# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settings.spec.ts >> Settings & Automations Flow >> User can create and delete Workflow Automations
- Location: tests\settings.spec.ts:75:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*\/dashboard/
Received string:  "http://localhost:3000/register"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    3 × unexpected value "http://localhost:3000/register?"
    6 × unexpected value "http://localhost:3000/register"

```

```yaml
- img "Flowzen"
- heading "Create your workspace" [level=1]
- paragraph: Start managing projects like a pro
- text: Organization name
- textbox "Your company name"
- text: Full name
- textbox "John Doe"
- text: Email
- textbox "you@company.com"
- text: Password
- textbox "Min. 8 characters"
- button
- button "Create workspace"
- paragraph:
  - text: Already have an account?
  - link "Sign in":
    - /url: /login
- img "Flowzen"
- heading "Built for agencies" [level=2]
- paragraph: Everything your team needs to deliver exceptional projects, on time and on budget.
- alert
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const testEmail = `test-admin-${Date.now()}@example.com`;
  4  | const password = 'Password123!';
  5  | 
  6  | test.describe('Settings & Automations Flow', () => {
  7  |   test.beforeAll(async ({ browser }) => {
  8  |     const page = await browser.newPage();
  9  |     await page.goto('/register');
  10 |     await page.fill('input[placeholder="Your company name"]', 'Settings Org');
  11 |     await page.fill('input[placeholder="John Doe"]', 'Settings Admin');
  12 |     await page.fill('input[placeholder="you@company.com"]', testEmail);
  13 |     await page.fill('input[type="password"]', password);
  14 |     await page.click('button[type="submit"]', { force: true });
> 15 |     await expect(page).toHaveURL(/.*\/dashboard/);
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  16 |     await page.close();
  17 |   });
  18 | 
  19 |   test.beforeEach(async ({ page }) => {
  20 |     await page.goto('/login');
  21 |     await page.fill('input[type="email"]', testEmail);
  22 |     await page.fill('input[type="password"]', password);
  23 |     await page.click('button[type="submit"]', { force: true });
  24 |     await expect(page).toHaveURL(/.*\/dashboard/);
  25 |   });
  26 | 
  27 |   test('User can update Organization Profile', async ({ page }) => {
  28 |     await page.click('a[href="/settings"]');
  29 |     await expect(page).toHaveURL(/.*\/settings/);
  30 | 
  31 |     // Click Organization tab (if not already selected)
  32 |     await page.click('button:has-text("Organization")');
  33 | 
  34 |     // Update settings
  35 |     await page.fill('input[placeholder="e.g. Technology, Healthcare"]', 'Tech Company');
  36 |     await page.fill('input[placeholder="e.g. +1 (555) 000-0000"]', '1234567890');
  37 |     
  38 |     // Save
  39 |     await page.click('button:has-text("Save Organization Profile")');
  40 |     
  41 |     // Should see success toast
  42 |     await expect(page.locator('text=Organization profile updated')).toBeVisible();
  43 |   });
  44 | 
  45 |   test('User can use Invite User Modal', async ({ page }) => {
  46 |     await page.click('a[href="/settings"]');
  47 |     await page.click('button:has-text("Users & Roles")');
  48 | 
  49 |     await page.click('button:has-text("Invite Member")');
  50 |     
  51 |     // Form validation
  52 |     await page.click('button:has-text("Send Invitation")');
  53 |     await expect(page.locator('button:has-text("Send Invitation")')).toBeVisible();
  54 | 
  55 |     await page.fill('input[type="email"]', 'new-member@example.com');
  56 |     // Assuming Select role works via native select or we just leave default
  57 |     await page.click('button:has-text("Send Invitation")');
  58 | 
  59 |     // Should see success
  60 |     await expect(page.locator('text=Invitation sent')).toBeVisible();
  61 |   });
  62 | 
  63 |   test('User can create Project Templates', async ({ page }) => {
  64 |     await page.click('a[href="/settings"]');
  65 |     await page.click('button:has-text("Templates")');
  66 | 
  67 |     await page.click('button:has-text("Create Template")');
  68 |     await page.fill('input[name="name"]', 'E2E Template');
  69 |     await page.fill('textarea[name="description"]', 'E2E test template');
  70 |     await page.click('button:has-text("Save Template")');
  71 | 
  72 |     await expect(page.locator('text=E2E Template')).toBeVisible();
  73 |   });
  74 | 
  75 |   test('User can create and delete Workflow Automations', async ({ page }) => {
  76 |     await page.click('a[href="/settings"]');
  77 |     await page.click('button:has-text("Automations")');
  78 | 
  79 |     await page.click('button:has-text("Create Workflow")');
  80 |     await page.fill('input[name="name"]', 'E2E Rule');
  81 |     
  82 |     // Choose conditions
  83 |     await page.selectOption('select[name="triggerType"]', 'TASK_CREATED');
  84 |     await page.selectOption('select[name="actionType"]', 'NOTIFY_USER');
  85 | 
  86 |     await page.click('button:has-text("Save Workflow")');
  87 | 
  88 |     // Should see the new rule
  89 |     await expect(page.locator('text=E2E Rule')).toBeVisible();
  90 | 
  91 |     // Delete rule
  92 |     await page.click('button:has-text("Delete"):not([class*="bg-red-50"])');
  93 |     // Confirm delete if modal exists, or it just deletes
  94 |     await expect(page.locator('text=E2E Rule')).toBeHidden();
  95 |   });
  96 | });
  97 | 
```