import { expect, request as playwrightRequest, test as setup } from '@playwright/test';
import { ADMIN, BOTH, COACH, PAGER_COUNT, PAGER_LAST_NAME, signInByApi, STATE } from './support';

/**
 * Runs once before the specs: saves a signed-in browser state for each seeded account
 * the specs reuse, and tops the athletes list up so it has more than one page.
 * Re-runnable: athletes that already exist are not created again.
 */
setup('sign in the seeded accounts and seed a second page of athletes', async ({ baseURL }) => {
  setup.setTimeout(120_000);
  const origin = baseURL!;

  const admin = await playwrightRequest.newContext({ baseURL: origin });
  await signInByApi(admin, origin, ADMIN.email);
  await admin.storageState({ path: STATE.admin });

  const existing = await admin.get('/api/v1/athletes', {
    params: { q: PAGER_LAST_NAME, pageSize: '1' },
  });
  expect(existing.status()).toBe(200);
  const { total } = (await existing.json()) as { total: number };
  for (let index = total + 1; index <= PAGER_COUNT; index += 1) {
    const created = await admin.post('/api/v1/athletes', {
      headers: { Origin: origin },
      data: {
        firstName: `Runner${String(index).padStart(2, '0')}`,
        lastName: PAGER_LAST_NAME,
        dateOfBirth: '2010-03-15',
      },
    });
    expect(created.status(), `create athlete ${index}`).toBe(201);
  }
  await admin.dispose();

  const coach = await playwrightRequest.newContext({ baseURL: origin });
  await signInByApi(coach, origin, COACH.email);
  await coach.storageState({ path: STATE.coach });
  await coach.dispose();

  const both = await playwrightRequest.newContext({ baseURL: origin });
  await signInByApi(both, origin, BOTH.email);
  await both.storageState({ path: STATE.both });
  await both.dispose();
});
