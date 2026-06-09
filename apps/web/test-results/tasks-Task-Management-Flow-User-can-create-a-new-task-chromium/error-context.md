# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tasks.spec.ts >> Task Management Flow >> User can create a new task
- Location: tests\tasks.spec.ts:28:7

# Error details

```
"beforeAll" hook timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [active]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - navigation [ref=e7]:
            - button "previous" [disabled] [ref=e8]:
              - img "previous" [ref=e9]
            - generic [ref=e11]:
              - generic [ref=e12]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e13]:
              - img "next" [ref=e14]
          - img
        - generic [ref=e16]:
          - generic [ref=e17]:
            - img [ref=e18]
            - generic "Latest available version is detected (16.2.7)." [ref=e20]: Next.js 16.2.7
            - generic [ref=e21]: Turbopack
          - img
      - dialog "Runtime ChunkLoadError" [ref=e23]:
        - generic [ref=e26]:
          - generic [ref=e27]:
            - generic [ref=e28]:
              - generic [ref=e30]: Runtime ChunkLoadError
              - generic [ref=e31]:
                - button "Copy Error Info" [ref=e32] [cursor=pointer]:
                  - img [ref=e33]
                - button "No related documentation found" [disabled] [ref=e35]:
                  - img [ref=e36]
                - button "Attach Node.js inspector" [ref=e38] [cursor=pointer]:
                  - img [ref=e39]
            - generic [ref=e48]: Failed to load chunk /_next/static/chunks/apps_web_src_app_register_page_tsx_0k2udye._.js from module [project]/node_modules/next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.development.js [app-client] (ecmascript)
          - generic [ref=e51]:
            - paragraph [ref=e52]:
              - text: Call Stack
              - generic [ref=e53]: "1"
            - button "Show 1 ignore-listed frame(s)" [ref=e54] [cursor=pointer]:
              - text: Show 1 ignore-listed frame(s)
              - img [ref=e55]
        - generic [ref=e57]: "1"
        - generic [ref=e58]: "2"
    - generic [ref=e63] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e64]:
        - img [ref=e65]
      - generic [ref=e68]:
        - button "Open issues overlay" [ref=e69]:
          - generic [ref=e70]:
            - generic [ref=e71]: "0"
            - generic [ref=e72]: "1"
          - generic [ref=e73]: Issue
        - button "Collapse issues badge" [ref=e74]:
          - img [ref=e75]
  - generic [ref=e78]:
    - img [ref=e79]
    - heading "This page couldn’t load" [level=1] [ref=e81]
    - paragraph [ref=e82]: Reload to try again, or go back.
    - generic [ref=e83]:
      - button "Reload" [ref=e85] [cursor=pointer]
      - button "Back" [ref=e86] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const testEmail = `test-task-${Date.now()}@example.com`;
  4  | const password = 'Password123!';
  5  | const taskName = `Task ${Date.now()}`;
  6  | 
  7  | test.describe('Task Management Flow', () => {
> 8  |   test.beforeAll(async ({ browser }) => {
     |        ^ "beforeAll" hook timeout of 60000ms exceeded.
  9  |     const page = await browser.newPage();
  10 |     await page.goto('/register');
  11 |     await page.fill('input[placeholder="Your company name"]', 'Task Org');
  12 |     await page.fill('input[placeholder="John Doe"]', 'Task Admin');
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
  28 |   test('User can create a new task', async ({ page }) => {
  29 |     await page.click('a[href="/tasks"]');
  30 |     await expect(page).toHaveURL(/.*\/tasks/);
  31 | 
  32 |     await page.click('button:has-text("Create Task")');
  33 | 
  34 |     // Validation check
  35 |     await page.click('button[type="submit"]', { force: true });
  36 |     await expect(page.locator('button:has-text("Create Task")')).toBeVisible();
  37 | 
  38 |     await page.fill('input[name="title"]', taskName);
  39 |     await page.selectOption('select[name="priority"]', 'HIGH');
  40 |     await page.click('button[type="submit"]', { force: true });
  41 | 
  42 |     // Should appear in Kanban board
  43 |     await expect(page.locator(`text=${taskName}`)).toBeVisible();
  44 |   });
  45 | 
  46 |   test('User can edit a task', async ({ page }) => {
  47 |     await page.click('a[href="/tasks"]');
  48 |     
  49 |     // Open task details by clicking on it
  50 |     await page.click(`text=${taskName}`);
  51 | 
  52 |     // Wait for the modal/panel to open, look for Edit button or just editable fields
  53 |     // Assuming there's a description field to edit
  54 |     await page.fill('textarea[name="description"]', 'Updated task description');
  55 |     
  56 |     // Assuming there's a save button in the detail view
  57 |     const saveButton = page.locator('button:has-text("Save")');
  58 |     if (await saveButton.isVisible()) {
  59 |       await saveButton.click();
  60 |     } else {
  61 |       // Might auto-save, but let's click close
  62 |       await page.click('button:has-text("Close")');
  63 |     }
  64 | 
  65 |     // Reopen and check
  66 |     await page.click(`text=${taskName}`);
  67 |     await expect(page.locator('textarea[name="description"]')).toHaveValue('Updated task description');
  68 |   });
  69 | 
  70 |   test('User can move a task via drag and drop', async ({ page }) => {
  71 |     await page.click('a[href="/tasks"]');
  72 |     
  73 |     // To test drag and drop in playwright, we can simulate the mouse events
  74 |     // But testing react-beautiful-dnd can be tricky, so we test changing status if possible
  75 |     // or rely on a fallback
  76 |     
  77 |     // If there's a status dropdown in the edit modal, we use that
  78 |     await page.click(`text=${taskName}`);
  79 |     await page.selectOption('select[name="status"]', 'IN_PROGRESS');
  80 |     
  81 |     const saveButton = page.locator('button:has-text("Save")');
  82 |     if (await saveButton.isVisible()) {
  83 |       await saveButton.click();
  84 |     } else {
  85 |       await page.click('button:has-text("Close")');
  86 |     }
  87 | 
  88 |     // The task should now be under IN PROGRESS column
  89 |     // The column might have a heading "IN PROGRESS"
  90 |     const column = page.locator('div', { has: page.locator('h3:has-text("In Progress")') });
  91 |     await expect(column.locator(`text=${taskName}`)).toBeVisible();
  92 |   });
  93 | });
  94 | 
```