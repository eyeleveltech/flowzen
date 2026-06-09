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


  test('Registration form validation prevents empty submission', async ({ page }) => {
    await page.goto('/register');
    
    // Submit empty form
    await page.click('button[type="submit"]', { force: true });
    
    // Check that we're still on the register page and validation messages might appear
    // The exact error text depends on the Zod schema, but we can verify it doesn't navigate
    await expect(page).toHaveURL(/.*\/register/);
    
    // Fill invalid email
    await page.fill('input[placeholder="you@company.com"]', 'not-an-email');
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/register/);
  });

  test('Login form validation prevents empty submission', async ({ page }) => {
    await page.goto('/login');
    
    // Submit empty form
    await page.click('button[type="submit"]', { force: true });
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('Forgot password flow', async ({ page }) => {
    // Navigate to forgot password from login page
    await page.goto('/login');
    await page.click('text="Forgot password?"');
    
    await expect(page).toHaveURL(/.*\/forgot-password/);
    
    // Submit empty should fail
    await page.click('button[type="submit"]', { force: true });
    
    // Fill email and submit
    await page.fill('input[type="email"]', testEmail);
    await page.click('button[type="submit"]', { force: true });
    
    // Should see success message or toast
    // The UI should show "Check your email" or similar
    await expect(page.locator('text=/check your email/i').or(page.locator('text=/reset link sent/i'))).toBeVisible({ timeout: 10000 });
  });
});
