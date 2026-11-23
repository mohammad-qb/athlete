import { expect, test } from '@playwright/test';
import { SEED, STATE } from './support';

/**
 * The same app, as a coach. `GET /me` reports the pairs a coach holds, and a control
 * the API would refuse for certain is not drawn. (This is a courtesy, not the control:
 * the API refuses the request itself, which `scripts/smoke.sh` asserts.)
 */
test.use({ storageState: STATE.coach });

test('a coach sees their athletes and teams, without the controls their role excludes', async ({
  page,
}) => {
  // `/` sends a coach to their sessions (an administrator goes to the athletes list).
  await page.goto('/');
  await expect(page).toHaveURL(/\/sessions$/);
  // A coach schedules sessions for their own teams, so that control IS drawn.
  await expect(page.getByRole('button', { name: 'New session' })).toBeVisible();

  await page.goto('/athletes');
  const menu = page.getByRole('list', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Athletes' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Teams' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Sessions' })).toBeVisible();

  // The list is drawn (the coach's own team's athletes), with no way to add to it.
  await expect(page.getByRole('link', { name: /Falcon/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add athlete' })).toHaveCount(0);

  // A coach MAY update the athletes they coach, so the edit form is theirs to use.
  await page.goto(`/athletes/${SEED.athleteOnTeamA}`);
  await expect(page.getByLabel('First name')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

  // Teams: only the team they coach, and no way to create one.
  await page.goto('/teams');
  await expect(page.getByRole('link', { name: 'Team A', exact: true })).toBeVisible();
  await expect(page.getByTestId('data-table-total')).toHaveText('1 team');
  await expect(page.getByRole('button', { name: 'New team' })).toHaveCount(0);

  // The roster is readable; adding to it and transferring from it are not offered.
  await page.getByRole('link', { name: 'Team A', exact: true }).click();
  const roster = page.getByRole('list', { name: 'Roster' });
  await expect(roster.getByRole('link').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add athlete' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Transfer / })).toHaveCount(0);
});

test("a coach who opens another team's address is told it is not there", async ({ page }) => {
  await page.goto('/teams/77777777-7777-7777-7777-777777777777');
  await expect(page.getByRole('alert')).toContainText('no longer exists');
});
