import path from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';

/** The accounts `scripts/seed-dev.sh` creates. */
export const PASSWORD = process.env.SEED_PASSWORD ?? 'athlete-dev-password';
export const ADMIN = { email: 'admin@alpha.test', name: 'Alpha Admin' };
export const BOTH = { email: 'both@alpha.test', name: 'Both Academies' };

/** Signed-in browser state, saved by `global.setup.ts` for specs that are not about signing in. */
export const STATE = {
  admin: path.join(import.meta.dirname, '.auth/admin.json'),
  both: path.join(import.meta.dirname, '.auth/both.json'),
};

/** Athletes the setup adds so that the list has a second page. */
export const PAGER_LAST_NAME = 'Pager';
export const PAGER_COUNT = 30;

const RATE_LIMIT_WAIT_MS = 11_000;

/**
 * Signs in over HTTP. better-auth allows three sign-in attempts per ten seconds from
 * one address (the stack runs it as production), and a test run makes more than that,
 * so a 429 is waited out rather than treated as a failure.
 */
export async function signInByApi(request: APIRequestContext, baseURL: string, email: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.post('/api/auth/sign-in/email', {
      headers: { Origin: baseURL },
      data: { email, password: PASSWORD },
    });
    if (response.status() !== 429) {
      expect(response.status(), `sign-in as ${email}`).toBe(200);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
  }
  throw new Error(`sign-in as ${email} stayed rate limited`);
}

/** Fills in and submits the sign-in form, waiting out the rate limit if it is hit. */
export async function submitSignIn(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    const answered = page.waitForResponse((response) =>
      response.url().includes('/api/auth/sign-in/email'),
    );
    await page.getByRole('button', { name: 'Sign in' }).click();
    if ((await answered).status() !== 429) return;
    await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
  }
  throw new Error('the sign-in form stayed rate limited');
}

/**
 * Records every request the page makes to another host. The SPA must make none
 * (data residency: self-hosted fonts, no analytics, no error-reporting SaaS).
 */
export function recordThirdPartyRequests(page: Page, baseURL: string): string[] {
  const foreign: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) foreign.push(url);
  });
  return foreign;
}
