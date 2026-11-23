import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, request as playwrightRequest, test } from '@playwright/test';
import {
  addMembership,
  COACH,
  createAthlete,
  createSession,
  expectNoHorizontalScroll,
  PASSWORD,
  SEED,
  STATE,
  submitSignIn,
  unique,
} from './support';

const SHOTS = path.join(import.meta.dirname, 'screenshots');
const DRAFT_PREFIX = 'athlete:draft:';
const MINUTE = 60_000;

/**
 * The coach's flow, on a phone: sign in, land on sessions, open one, mark everyone,
 * submit once. Proven against the real API, including the two things that are hard to
 * see by hand: marks surviving a reload, and a submission that is sent twice storing
 * each entry once.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

/** How many drafts this browser holds. */
function draftCount(page: Page): Promise<number> {
  return page.evaluate(
    (prefix) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix)).length,
    DRAFT_PREFIX,
  );
}

function choice(page: Page, athlete: string, status: string) {
  return page
    .getByRole('radiogroup', { name: `Attendance for ${athlete}` })
    .getByRole('radio', { name: status });
}

test('a coach marks a register on a phone, across a reload and a failed submission', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const origin = baseURL!;

  // Four athletes on the coach's team around the session's start, and two sessions.
  // The memberships are a few minutes long, so another run's athletes are not on this
  // run's roster; the seeded athlete (on Team A all year) always is.
  const admin = await playwrightRequest.newContext({ baseURL: origin, storageState: STATE.admin });
  const lastName = unique('Register');
  const start = new Date(Math.floor(Date.now() / 1000) * 1000);
  const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE).toISOString();
  const names: string[] = [];
  for (const firstName of ['Ada', 'Bo', 'Cy', 'Di']) {
    const athlete = await createAthlete(admin, origin, { firstName, lastName });
    await addMembership(admin, origin, SEED.teamA, {
      athleteId: athlete.id,
      validFrom: at(-2),
      validTo: at(2),
    });
    names.push(`${firstName} ${lastName}`);
  }
  const [ada, bo] = names as [string, string, string, string];
  const session = await createSession(admin, origin, {
    teamId: SEED.teamA,
    startsAt: at(0),
    endsAt: at(60),
    location: lastName,
  });
  const second = await createSession(admin, origin, {
    teamId: SEED.teamA,
    startsAt: at(1),
    endsAt: at(61),
  });
  await admin.dispose();

  // Signs in, and lands on sessions: a coach's work starts there.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await submitSignIn(page, COACH.email, PASSWORD);
  await expect(page).toHaveURL(/\/sessions$/);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, 'coach-sessions-390.png') });

  // Opens the session from the list.
  await page.locator(`a[href$="/sessions/${session.id}/attendance"]`).click();
  await expect(page.getByTestId('session-team')).toHaveText('Team A');
  const pending = page.getByTestId('pending-row');
  await expect(pending.first()).toBeVisible();
  const total = await pending.count();
  expect(total).toBeGreaterThanOrEqual(5);
  const progress = page.getByTestId('register-progress');
  await expect(progress).toHaveText(`0 of ${total} marked`);
  const submit = page.getByRole('button', { name: 'Submit register' });
  await expect(submit).toBeDisabled();

  // Marks some: one late with a note, one absent.
  await choice(page, ada, 'Late').check();
  await page.getByRole('button', { name: `Add a note for ${ada}` }).click();
  await page.getByLabel(`Note for ${ada}`).fill('missed the bus');
  await choice(page, bo, 'Absent').check();
  await expect(progress).toHaveText(`2 of ${total} marked`);
  await expect(submit).toBeDisabled();
  await page.evaluate(() => document.fonts.ready);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, 'attendance-390.png') });

  // A reload finds the marks.
  await page.reload();
  await expect(choice(page, ada, 'Late')).toBeChecked();
  await expect(page.getByLabel(`Note for ${ada}`)).toHaveValue('missed the bus');
  await expect(choice(page, bo, 'Absent')).toBeChecked();
  await expect(progress).toHaveText(`2 of ${total} marked`);

  // Marks the rest.
  await page.getByRole('button', { name: 'Mark rest present' }).click();
  await expect(progress).toHaveText(`${total} of ${total} marked`);
  await expect(choice(page, ada, 'Late')).toBeChecked();

  // The first submission REACHES the API and is stored, and its answer is then lost:
  // the worst case for a retry, because the phone cannot know it worked.
  let submissions = 0;
  await page.route(`**/api/v1/sessions/${session.id}/attendance`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions += 1;
    if (submissions > 1) return route.continue();
    const answered = await route.fetch();
    expect(answered.status()).toBe(201);
    await route.abort('connectionreset');
  });
  await submit.click();
  await expect(page.getByText('Not submitted. Your marks are kept; try again.')).toBeVisible();
  await expect(choice(page, bo, 'Absent')).toBeChecked();
  expect(await draftCount(page)).toBe(1);

  // Trying again sends the same ids, so nothing is stored twice.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Register submitted.')).toBeVisible();
  expect(submissions).toBe(2);
  const recorded = page.getByRole('list', { name: 'Recorded attendance' });
  await expect(recorded.getByRole('listitem')).toHaveCount(total);
  await expect(page.getByTestId('recorded-summary')).toHaveText(
    `${total} athletes, the whole register`,
  );
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  const adaRow = recorded.getByRole('listitem').filter({ hasText: ada });
  await expect(adaRow).toContainText('Late');
  await expect(adaRow).toContainText('missed the bus');
  await expect(recorded.getByRole('listitem').filter({ hasText: bo })).toContainText('Absent');
  expect(await draftCount(page)).toBe(0);

  // What the API holds: one entry per athlete, not two.
  const stored = await page.request.get(`/api/v1/sessions/${session.id}/attendance`);
  const entries = (await stored.json()) as { athleteId: string }[];
  expect(entries).toHaveLength(total);
  expect(new Set(entries.map((entry) => entry.athleteId)).size).toBe(total);

  // And it is the register from now on.
  await page.reload();
  await expect(recorded.getByRole('listitem')).toHaveCount(total);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, 'attendance-recorded-390.png') });

  // A draft left unfinished in another register does not outlive the session.
  await page.goto(`/sessions/${second.id}/attendance`);
  await choice(page, ada, 'Present').check();
  expect(await draftCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  // Sign-out leaves for sign-in first and forgets the drafts after, so the address
  // changes a moment before they are gone.
  await expect.poll(() => draftCount(page)).toBe(0);
});

test.describe('scheduling', () => {
  test.use({ storageState: STATE.coach });

  test('a coach schedules a session for their team and finds it in the list', async ({ page }) => {
    const location = unique('Pitch');
    await page.goto('/sessions');
    await page.getByRole('button', { name: 'New session' }).click();
    const dialog = page.getByRole('dialog', { name: 'New session' });

    // Validated before anything is sent: a team and both times are missing.
    await dialog.getByRole('button', { name: 'Create session' }).click();
    await expect(dialog.getByText('Required.')).toHaveCount(3);

    // The picker offers the coach's own team, and no other.
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await dialog.getByRole('option', { name: /Team A/ }).click();
    await dialog.getByLabel('Starts').fill('17:00');
    await dialog.getByLabel('Ends').fill('16:00');
    await dialog.getByLabel('Location').fill(location);
    await dialog.getByRole('button', { name: 'Create session' }).click();
    await expect(dialog.getByText('The session must end after it starts.')).toBeVisible();

    await dialog.getByLabel('Ends').fill('18:30');
    await expectNoHorizontalScroll(page);
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/sessions') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Create session' }).click();
    const created = (await (await creating).json()) as { id: string };
    await expect(page.getByText(/^Session created for .*17:00–18:30\.$/)).toBeVisible();
    await expect(dialog).toBeHidden();

    // The list was refreshed; the new session opens its register. Found by its id:
    // an earlier run on the same database made a session at the same time of day.
    await page.locator(`a[href$="/sessions/${created.id}/attendance"]`).click();
    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}\/attendance$/);
    await expect(page.getByText(new RegExp(`17:00–18:30, ${location}`))).toBeVisible();
  });

  test('an address that names no session says so instead of breaking', async ({ page }) => {
    await page.goto('/sessions/00000000-0000-0000-0000-000000000000/attendance');
    await expect(page.getByRole('alert')).toContainText('no longer exists');
    await page.getByRole('link', { name: 'Sessions' }).first().click();
    await expect(page).toHaveURL(/\/sessions$/);
  });
});
