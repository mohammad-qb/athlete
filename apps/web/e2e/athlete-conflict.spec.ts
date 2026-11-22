import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type Browser, expect, type Page, request as playwrightRequest, test } from '@playwright/test';
import { createAthlete, expectNoHorizontalScroll, STATE, unique } from './support';

const SHOTS = path.join(import.meta.dirname, 'screenshots');

/**
 * Two people edit the same athlete. The second save is refused (409 `stale_write`,
 * `apps/api/src/common/http/optimistic-concurrency.ts`) and the second person is shown
 * what the first one changed, with both ways out. Nothing is mocked: the 409 is the
 * API's, from the real database.
 */

/** A fresh athlete, opened in two separate browser contexts (two people). */
async function openInTwoBrowsers(browser: Browser, baseURL: string) {
  const api = await playwrightRequest.newContext({ baseURL, storageState: STATE.admin });
  const lastName = unique('Conflict');
  const { id } = await createAthlete(api, baseURL, { firstName: 'Original', lastName });
  await api.dispose();

  const open = async (): Promise<Page> => {
    const context = await browser.newContext({ storageState: STATE.admin, baseURL });
    const page = await context.newPage();
    await page.goto(`/athletes/${id}`);
    await expect(page.getByLabel('Last name')).toHaveValue(lastName);
    return page;
  };
  return { first: await open(), second: await open(), lastName };
}

async function closeBoth(...pages: Page[]) {
  for (const page of pages) await page.context().close();
}

/** The first person renames the athlete; the second, who loaded before that, saves a first name. */
async function saveIntoConflict(first: Page, second: Page, theirLastName: string) {
  await first.getByLabel('Last name').fill(theirLastName);
  await first.getByRole('button', { name: 'Save changes' }).click();
  await expect(first.getByText('Athlete saved.')).toBeVisible();

  await second.getByLabel('First name').fill('Mine');
  await second.getByRole('button', { name: 'Save changes' }).click();

  const dialog = second.getByRole('dialog', { name: 'Someone else changed this athlete' });
  await expect(dialog).toBeVisible();
  // The first person's change, beside what this form still says.
  const lastName = dialog.getByTestId('conflict-lastName');
  await expect(lastName.getByTestId('conflict-theirs')).toHaveText(theirLastName);
  await expect(lastName.getByText('Theirs (changed)')).toBeVisible();
  const firstName = dialog.getByTestId('conflict-firstName');
  await expect(firstName.getByTestId('conflict-theirs')).toHaveText('Original');
  await expect(firstName.getByTestId('conflict-mine')).toHaveText('Mine');
  // A field nobody touched is not in the dialog.
  await expect(dialog.getByTestId('conflict-dateOfBirth')).toHaveCount(0);
  // Nothing of the second person's has been saved, and their form is still filled in.
  await expect(second.getByLabel('First name')).toHaveValue('Mine');
  return dialog;
}

test('"Keep mine" saves the second person\'s form over the newer version', async ({
  browser,
  baseURL,
}) => {
  const { first, second, lastName } = await openInTwoBrowsers(browser, baseURL!);
  const dialog = await saveIntoConflict(first, second, 'Theirs');

  // The dialog at desktop and at phone width.
  mkdirSync(SHOTS, { recursive: true });
  for (const [name, width, height] of [['1280', 1280, 800], ['390', 390, 844]] as const) {
    await second.setViewportSize({ width, height });
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalScroll(second);
    await second.screenshot({
      path: path.join(SHOTS, `athlete-conflict-${name}.png`),
      animations: 'disabled',
    });
  }

  await dialog.getByRole('button', { name: 'Keep mine' }).click();
  await expect(dialog).toBeHidden();
  await expect(second.getByText('Athlete saved.')).toBeVisible();

  // What is stored is the second person's form, whole: their first name, and the last
  // name the dialog showed them as "Yours".
  await second.reload();
  await expect(second.getByLabel('First name')).toHaveValue('Mine');
  await expect(second.getByLabel('Last name')).toHaveValue(lastName);

  // And the save moved the form to the new version: a further edit is not a conflict.
  await second.getByLabel('First name').fill('Mine again');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByText('Athlete saved.')).toBeVisible();
  await expect(second.getByRole('dialog')).toHaveCount(0);

  await closeBoth(first, second);
});

test('"Take theirs" drops the second person\'s edit for the stored version', async ({
  browser,
  baseURL,
}) => {
  const { first, second } = await openInTwoBrowsers(browser, baseURL!);
  const dialog = await saveIntoConflict(first, second, 'Theirs');

  await dialog.getByRole('button', { name: 'Take theirs' }).click();
  await expect(dialog).toBeHidden();
  await expect(second.getByLabel('First name')).toHaveValue('Original');
  await expect(second.getByLabel('Last name')).toHaveValue('Theirs');

  // Nothing was written by the second person.
  await second.reload();
  await expect(second.getByLabel('First name')).toHaveValue('Original');
  await expect(second.getByLabel('Last name')).toHaveValue('Theirs');

  // The form now stands on their version: the next save goes through.
  await second.getByLabel('First name').fill('Later');
  await second.getByRole('button', { name: 'Save changes' }).click();
  await expect(second.getByText('Athlete saved.')).toBeVisible();
  await expect(second.getByRole('dialog')).toHaveCount(0);

  await closeBoth(first, second);
});
