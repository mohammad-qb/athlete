import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  BOTH,
  createSession,
  expectNoHorizontalScroll,
  PASSWORD,
  SEED,
  STATE,
} from './support';

const SHOTS = path.join(import.meta.dirname, 'screenshots');
const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
] as const;

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('sign-in fits the screen', async ({ page }) => {
      await page.goto('/sign-in');
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: path.join(SHOTS, `sign-in-${viewport.name}.png`) });
    });

    test.describe('signed in', () => {
      test.use({ storageState: STATE.admin });

      test('the athletes list fits the screen', async ({ page }) => {
        await page.goto('/athletes');
        await expect(page.locator('tbody tr')).toHaveCount(25);
        await page.evaluate(() => document.fonts.ready);
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `athletes-${viewport.name}.png`) });
      });

      test('an athlete, the teams list and a team fit the screen', async ({ page }) => {
        await page.goto(`/athletes/${SEED.athleteOnTeamA}`);
        await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `athlete-${viewport.name}.png`) });

        await page.goto('/teams');
        await expect(page.getByRole('link', { name: 'Team A', exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `teams-${viewport.name}.png`) });

        await page.goto(`/teams/${SEED.teamA}`);
        await expect(page.getByRole('list', { name: 'Roster' })).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `team-${viewport.name}.png`) });

        // The dialogs are part of the screen: they must fit it too.
        await page.getByRole('button', { name: 'Add athlete' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('option').first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: path.join(SHOTS, `team-add-athlete-${viewport.name}.png`),
          animations: 'disabled',
        });
      });

      test('the sessions list, a register and the new-session dialog fit the screen', async ({
        page,
        baseURL,
      }) => {
        // A session of the seeded team, starting now: its register has the seeded athlete.
        const start = new Date(Math.floor(Date.now() / 1000) * 1000);
        const session = await createSession(page.request, baseURL!, {
          teamId: SEED.teamA,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 90 * 60_000).toISOString(),
          location: 'Main pitch',
        });

        await page.goto('/sessions');
        await expect(page.locator(`a[href$="/sessions/${session.id}/attendance"]`)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `sessions-${viewport.name}.png`) });

        await page.getByRole('button', { name: 'New session' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('option').first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: path.join(SHOTS, `session-new-${viewport.name}.png`),
          animations: 'disabled',
        });
        await page.getByRole('button', { name: 'Cancel' }).click();

        await page.goto(`/sessions/${session.id}/attendance`);
        await expect(page.getByTestId('register-progress')).toBeVisible();
        await page.getByRole('radio', { name: 'Present' }).first().check();
        await expectNoHorizontalScroll(page);
        await page.screenshot({ path: path.join(SHOTS, `register-${viewport.name}.png`) });
      });
    });
  });
}

test.describe('someone who belongs to two academies', () => {
  test.use({ storageState: STATE.both });

  test('switches academy, and sees the other academy with the other role', async ({ page }) => {
    await page.goto('/athletes');
    const academy = page.getByTestId('active-academy');
    await expect(academy).toContainText(/Alpha Academy|Beta Academy/);

    // Whichever academy the session is in, go to the other one and back.
    const start = (await academy.innerText()).includes('Alpha') ? 'Alpha Academy' : 'Beta Academy';
    const other = start === 'Alpha Academy' ? 'Beta Academy' : 'Alpha Academy';
    for (const target of [other, start]) {
      const switched = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/me/active-academy') && response.status() === 200,
      );
      await academy.click();
      await page.getByRole('menuitem', { name: target }).click();
      await switched;
      // The menu animates shut; the next round must open a new one, not catch this one.
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(academy).toContainText(target);
      // The landing page is chosen again for the role held THERE: an administrator's
      // athletes in Beta, a coach's sessions in Alpha.
      await expect(page).toHaveURL(target === 'Beta Academy' ? /\/athletes$/ : /\/sessions$/);
      // The page is redrawn for the new academy, never left showing the previous one.
      // In Beta this person is an administrator of an academy with no athletes; in
      // Alpha, a coach with no team, whom the API refuses the list.
      await expect(
        page.getByText(
          target === 'Beta Academy'
            ? 'No athletes yet.'
            : 'You do not have access to this list in this academy.',
        ),
      ).toBeVisible();
    }
  });
});

test.describe('the account page', () => {
  test.use({ storageState: STATE.both });

  test('refuses a wrong current password on the field, and mismatched passwords before sending', async ({
    page,
  }) => {
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByText(`Signed in as ${BOTH.name}`)).toBeVisible();

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill('a-new-long-password');
    await page.getByLabel('Confirm new password').fill('a-different-password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();

    await page.getByLabel('Current password').fill('not-my-password');
    await page.getByLabel('Confirm new password').fill('a-new-long-password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That is not your current password.')).toBeVisible();
  });
});
