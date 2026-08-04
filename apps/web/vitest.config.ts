import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react() as any],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.ts'],
    // `tests/` holds Playwright end-to-end specs, which are run by playwright.config.ts, not here.
    // Without this, vitest collected all six of them and each failed to even load with
    // "Playwright Test did not expect test.describe() to be called here" — six permanent red
    // files that made a genuinely broken unit test indistinguishable from the usual noise.
    exclude: [...configDefaults.exclude, 'tests/**'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
