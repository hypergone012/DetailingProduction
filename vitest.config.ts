import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.test.ts', 'tests/unit/**/*.test.ts', 'scripts/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['tests/db/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
