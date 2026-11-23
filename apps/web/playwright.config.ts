import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the REAL stack: the compose `web` service (the SPA behind
 * nginx, `/api` proxied to the API) with a migrated, seeded database. Nothing is
 * mocked, and nothing is started from here:
 *
 *   docker compose up -d --build && docker compose run --rm migrate
 *   ./scripts/seed-dev.sh
 *   pnpm --filter @athlete/web run test:e2e
 */
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '8080'}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // One worker, in file order: the specs share one database and one sign-in rate limit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
