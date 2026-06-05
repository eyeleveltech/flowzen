# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication & Onboarding Flow >> User can logout
- Location: tests\auth.spec.ts:25:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.fill: Test timeout of 60000ms exceeded.
Call log:
  - waiting for locator('input[type="email"]')

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | // Use a unique email for each run to avoid collision
  4  | const testEmail = `test-user-${Date.now()}@example.com`;
  5  | const password = 'Password123!';
  6  | const orgName = `Org-${Date.now()}`;
  7  | 
  8  | test.describe('Authentication & Onboarding Flow', () => {
  9  |   test('User can register successfully', async ({ page }) => {
  10 |     await page.goto('/register');
  11 |     
  12 |     // Fill out registration form
  13 |     await page.fill('input[placeholder="Your company name"]', orgName);
  14 |     await page.fill('input[placeholder="John Doe"]', 'Test User');
  15 |     await page.fill('input[placeholder="you@company.com"]', testEmail);
  16 |     await page.fill('input[type="password"]', password);
  17 |     
  18 |     await page.click('button[type="submit"]', { force: true });
  19 | 
  20 |     // Should redirect to dashboard
  21 |     await expect(page).toHaveURL(/.*\/dashboard/);
  22 |     await expect(page.locator('h1')).toContainText('Overview');
  23 |   });
  24 | 
  25 |   test('User can logout', async ({ page }) => {
  26 |     await page.goto('/login');
> 27 |     await page.fill('input[type="email"]', testEmail);
     |                ^ Error: page.fill: Test timeout of 60000ms exceeded.
  28 |     await page.fill('input[type="password"]', password);
  29 |     await page.click('button[type="submit"]', { force: true });
  30 |     
  31 |     await expect(page).toHaveURL(/.*\/dashboard/);
  32 | 
  33 |     // Open user menu and logout
  34 |     // Depends on the layout, assuming a button with 'Log out' text or similar in sidebar
  35 |     const logoutButton = page.locator('button:has-text("Log out")');
  36 |     if (await logoutButton.isVisible()) {
  37 |         await logoutButton.click();
  38 |     } else {
  39 |         // We might need to click a user profile dropdown first
  40 |         await page.click('button:has(img[alt="Avatar"])');
  41 |         await page.click('button:has-text("Log out")');
  42 |     }
  43 | 
  44 |     // Should redirect to login page
  45 |     await expect(page).toHaveURL(/.*\/login/);
  46 |   });
  47 | 
  48 |   test('User can login with HttpOnly cookies', async ({ page }) => {
  49 |     await page.goto('/login');
  50 |     
  51 |     // Fill login form
  52 |     await page.fill('input[type="email"]', testEmail);
  53 |     await page.fill('input[type="password"]', password);
  54 |     
  55 |     await page.click('button[type="submit"]', { force: true });
  56 | 
  57 |     // Should redirect to dashboard
  58 |     await expect(page).toHaveURL(/.*\/dashboard/);
  59 | 
  60 |     // Verify localStorage does NOT contain the token anymore (HttpOnly test)
  61 |     const token = await page.evaluate(() => localStorage.getItem('flowzen-token'));
  62 |     expect(token).toBeNull();
  63 |   });
  64 | });
  65 | 
```