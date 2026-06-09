# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: clients.spec.ts >> Client Management Flow >> User can edit client details
- Location: tests\clients.spec.ts:46:7

# Error details

```
"beforeAll" hook timeout of 60000ms exceeded.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const testEmail = `test-client-${Date.now()}@example.com`;
  4  | const password = 'Password123!';
  5  | const clientName = `Client ${Date.now()}`;
  6  | 
  7  | test.describe('Client Management Flow', () => {
> 8  |   test.beforeAll(async ({ browser }) => {
     |        ^ "beforeAll" hook timeout of 60000ms exceeded.
  9  |     const page = await browser.newPage();
  10 |     await page.goto('/register');
  11 |     await page.fill('input[placeholder="Your company name"]', 'Client Org');
  12 |     await page.fill('input[placeholder="John Doe"]', 'Client Admin');
  13 |     await page.fill('input[placeholder="you@company.com"]', testEmail);
  14 |     await page.fill('input[type="password"]', password);
  15 |     await page.click('button[type="submit"]', { force: true });
  16 |     await expect(page).toHaveURL(/.*\/dashboard/);
  17 |     await page.close();
  18 |   });
  19 | 
  20 |   test.beforeEach(async ({ page }) => {
  21 |     await page.goto('/login');
  22 |     await page.fill('input[type="email"]', testEmail);
  23 |     await page.fill('input[type="password"]', password);
  24 |     await page.click('button[type="submit"]', { force: true });
  25 |     await expect(page).toHaveURL(/.*\/dashboard/);
  26 |   });
  27 | 
  28 |   test('User can create a new client', async ({ page }) => {
  29 |     await page.click('a[href="/clients"]');
  30 |     await expect(page).toHaveURL(/.*\/clients/);
  31 | 
  32 |     await page.click('button:has-text("New Client")');
  33 | 
  34 |     // Validation check
  35 |     await page.click('button[type="submit"]', { force: true });
  36 |     await expect(page.locator('button:has-text("New Client")')).toBeVisible();
  37 | 
  38 |     await page.fill('input[name="name"]', clientName);
  39 |     await page.fill('input[name="industry"]', 'Finance');
  40 |     await page.click('button[type="submit"]', { force: true });
  41 | 
  42 |     // Should appear in list
  43 |     await expect(page.locator(`text=${clientName}`)).toBeVisible();
  44 |   });
  45 | 
  46 |   test('User can edit client details', async ({ page }) => {
  47 |     await page.click('a[href="/clients"]');
  48 |     await page.click(`text=${clientName}`);
  49 | 
  50 |     await expect(page).toHaveURL(/.*\/clients\/.+/);
  51 | 
  52 |     await page.click('button:has-text("Edit Client")');
  53 |     await page.fill('input[name="industry"]', 'Updated Industry');
  54 |     await page.click('button[type="submit"]', { force: true });
  55 | 
  56 |     await expect(page.locator('text=Updated Industry')).toBeVisible();
  57 |   });
  58 | 
  59 |   test('Internal Client Logic renders correctly', async ({ page }) => {
  60 |     await page.click('a[href="/clients"]');
  61 |     
  62 |     // The Internal client should always exist
  63 |     await page.click(`text=Client Org (Internal)`);
  64 |     await expect(page).toHaveURL(/.*\/clients\/.+/);
  65 | 
  66 |     // Should NOT have an edit client button
  67 |     await expect(page.locator('button:has-text("Edit Client")')).toBeHidden();
  68 | 
  69 |     // Should show Organization Profile section
  70 |     await expect(page.locator('text=Organization Profile')).toBeVisible();
  71 |   });
  72 | });
  73 | 
```