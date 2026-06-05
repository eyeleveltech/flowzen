import { test, expect } from '@playwright/test';

// Use a unique email for each run to avoid collision
const testEmail = `test-user-${Date.now()}@example.com`;
const password = 'Password123!';
const orgName = `Org-${Date.now()}`;

test.describe('Authentication & Onboarding Flow', () => {
  test('User can register successfully', async ({ page }) => {
    await page.goto('/register');
    
    // Fill out registration form
    await page.fill('input[placeholder="Your company name"]', orgName);
    await page.fill('input[placeholder="John Doe"]', 'Test User');
    await page.fill('input[placeholder="you@company.com"]', testEmail);
    await page.fill('input[type="password"]', password);
    
    await page.click('button[type="submit"]', { force: true });

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*\/dashboard/);
    await expect(page.locator('h1')).toContainText('Overview');
  });

  test('User can logout', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]', { force: true });
    
    await expect(page).toHaveURL(/.*\/dashboard/);

    // Open user menu and logout
    // Depends on the layout, assuming a button with 'Log out' text or similar in sidebar
    const logoutButton = page.locator('button:has-text("Log out")');
    if (await logoutButton.isVisible()) {
        await logoutButton.click();
    } else {
        // We might need to click a user profile dropdown first
        await page.click('button:has(img[alt="Avatar"])');
        await page.click('button:has-text("Log out")');
    }

    // Should redirect to login page
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('User can login with HttpOnly cookies', async ({ page }) => {
    await page.goto('/login');
    
    // Fill login form
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', password);
    
    await page.click('button[type="submit"]', { force: true });

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*\/dashboard/);

    // Verify localStorage does NOT contain the token anymore (HttpOnly test)
    const token = await page.evaluate(() => localStorage.getItem('flowzen-token'));
    expect(token).toBeNull();
  });
});
