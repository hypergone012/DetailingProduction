import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end: the real web app (Vite) against the local stack (Postgres, Auth, PostgREST,
 * Storage, Edge Functions gateway). tests/e2e/global-setup.ts checks the stack, starts the
 * gateway if needed and creates an isolated studio; global teardown deletes it.
 */
const PORT = 5173 // allowed by the local ALLOWED_ORIGINS (scripts/local/env.ts)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: {
    command: `pnpm --filter @dp/web exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
