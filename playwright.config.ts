import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end: the real web app (Vite) against the local stack (Postgres, Auth, PostgREST,
 * Storage, Edge Functions gateway). tests/e2e/global-setup.ts checks the stack, starts the
 * gateway if needed and creates an isolated studio; global teardown deletes it.
 */
const PORT = 5173 // allowed by the local ALLOWED_ORIGINS (scripts/local/env.ts)
// E2E_BASE_URL: run against an already running server instead (e.g. the single-origin
// server gateway serving the built app) — no Vite dev server is started then.
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, '')

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
    baseURL: BASE_URL ?? `http://127.0.0.1:${PORT}`,
    // A test server with a self-signed certificate (the server installer test).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @dp/web exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
