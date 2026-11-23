import { expect, type Page, test } from '@playwright/test';
import { STATE, unique } from './support';

test.use({ storageState: STATE.admin });

async function createTeam(page: Page, name: string) {
  await page.goto('/teams');
  await page.getByRole('button', { name: 'New team' }).click();
  const dialog = page.getByRole('dialog', { name: 'New team' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Sport').fill('football');
  await dialog.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByText(`${name} created.`)).toBeVisible();
  await expect(dialog).toBeHidden();
}

test('an admin adds an athlete, finds them in the list and edits them', async ({ page }) => {
  const lastName = unique('Added');
  await page.goto('/athletes');
  await page.getByRole('button', { name: 'Add athlete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add athlete' });

  // Validated with the request's own schema before anything is sent.
  await dialog.getByRole('button', { name: 'Add athlete' }).click();
  await expect(dialog.getByText('Required.')).toHaveCount(3);

  await dialog.getByLabel('First name').fill('Noor');
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByLabel('Date of birth').fill('2010-04-09');
  await dialog.getByRole('button', { name: 'Add athlete' }).click();
  await expect(page.getByText(`Noor ${lastName} added.`)).toBeVisible();
  await expect(dialog).toBeHidden();

  // The list was refreshed: the new athlete is findable without a reload.
  await page.getByRole('searchbox', { name: 'Search athletes' }).fill(lastName);
  await page.getByRole('link', { name: lastName }).click();
  await expect(page).toHaveURL(/\/athletes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('athlete-name')).toHaveText(`Noor ${lastName}`);
  await expect(page.getByLabel('Date of birth')).toHaveValue('2010-04-09');

  await page.getByLabel('First name').fill('Nour');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Athlete saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('First name')).toHaveValue('Nour');
});

test('an address that names no athlete says so instead of breaking', async ({ page }) => {
  await page.goto('/athletes/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('no longer exists');
  await page.getByRole('link', { name: 'Athletes' }).first().click();
  await expect(page).toHaveURL(/\/athletes$/);
});

test('an admin builds a team, adds an athlete, and transfers them without rewriting the past', async ({
  page,
}) => {
  const from = unique('From');
  const to = unique('To');
  const lastName = unique('Mover');

  // An athlete to move, made through the screen an admin would use.
  await page.goto('/athletes');
  await page.getByRole('button', { name: 'Add athlete' }).click();
  const addAthlete = page.getByRole('dialog', { name: 'Add athlete' });
  await addAthlete.getByLabel('First name').fill('Sami');
  await addAthlete.getByLabel('Last name').fill(lastName);
  await addAthlete.getByLabel('Date of birth').fill('2009-09-01');
  await addAthlete.getByRole('button', { name: 'Add athlete' }).click();
  await expect(addAthlete).toBeHidden();

  await createTeam(page, to);
  await createTeam(page, from);

  // The new team is in the list; its page starts with an empty roster.
  await page.getByRole('searchbox', { name: 'Search teams' }).fill(from);
  await page.getByRole('link', { name: from }).click();
  await expect(page.getByTestId('team-name')).toHaveText(from);
  await expect(page.getByText('Nobody is on this team yet.')).toBeVisible();

  // Add the athlete, as a member since the start of the year.
  const fullName = `Sami ${lastName}`;
  const addToTeam = async (firstDay: string) => {
    await page.getByRole('button', { name: 'Add athlete' }).click();
    const dialog = page.getByRole('dialog', { name: `Add an athlete to ${from}` });
    await dialog.getByRole('searchbox', { name: 'Athlete' }).fill(lastName);
    await dialog.getByRole('option', { name: new RegExp(fullName) }).click();
    await dialog.getByLabel('First day').fill(firstDay);
    await dialog.getByRole('button', { name: 'Add to team' }).click();
    return dialog;
  };
  const added = await addToTeam('2026-01-01');
  await expect(page.getByText(`${fullName} added to ${from}.`)).toBeVisible();
  await expect(added).toBeHidden();
  const roster = page.getByRole('list', { name: 'Roster' });
  await expect(roster.getByRole('link', { name: fullName })).toBeVisible();
  await expect(page.getByTestId('roster-summary')).toHaveText('1 athlete today');

  // The database refuses a second, overlapping membership; the person is told which rule.
  const refused = await addToTeam('2026-06-01');
  await expect(page.getByText('The athlete is already on this team during that period')).toBeVisible();
  await expect(refused).toBeVisible();
  await refused.getByRole('button', { name: 'Cancel' }).click();

  // Transfer them, effective today.
  await roster.getByRole('button', { name: `Transfer ${fullName}` }).click();
  const transfer = page.getByRole('dialog', { name: `Transfer ${fullName}` });
  await transfer.getByRole('searchbox', { name: 'Destination team' }).fill(to);
  await transfer.getByRole('option', { name: new RegExp(to) }).click();
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(page.getByText(`${fullName} transferred to ${to}.`)).toBeVisible();
  await expect(transfer).toBeHidden();

  // Today they are gone from this team...
  await expect(page.getByText('Nobody is on this team yet.')).toBeVisible();
  // ...but the roster as of a day before the transfer still names them, and a past day
  // is a record to read: there is nothing to add to it or transfer from it.
  await page.getByLabel('As of').fill('2026-02-01');
  await expect(page).toHaveURL(/on=2026-02-01/);
  await expect(roster.getByRole('link', { name: fullName })).toBeVisible();
  await expect(page.getByTestId('roster-summary')).toHaveText('1 athlete on 1 Feb 2026');
  await expect(page.getByRole('button', { name: `Transfer ${fullName}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add athlete' })).toHaveCount(0);
  // The day is in the address bar: a reload shows the same roster.
  await page.reload();
  await expect(roster.getByRole('link', { name: fullName })).toBeVisible();

  // And they are on the destination team's roster now.
  await page.goto('/teams');
  await page.getByRole('searchbox', { name: 'Search teams' }).fill(to);
  await page.getByRole('link', { name: to }).click();
  await expect(page.getByRole('list', { name: 'Roster' }).getByRole('link', { name: fullName })).toBeVisible();
});
