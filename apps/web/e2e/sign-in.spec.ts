import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD, recordThirdPartyRequests, submitSignIn } from './support';

// One story, in order: each step starts where the previous one left the stack.
test.describe.configure({ mode: 'serial' });

test('a signed-out visit to /athletes is sent to sign-in, remembering the page', async ({ page }) => {
  await page.goto('/athletes?sort=-createdAt');
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('the form is validated before anything is sent', async ({ page }) => {
  await page.goto('/sign-in');
  let sent = false;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/sign-in')) sent = true;
  });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your email address.')).toBeVisible();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  expect(sent).toBe(false);
});

test('a wrong password shows an error and stays on sign-in', async ({ page }) => {
  await page.goto('/sign-in');
  await submitSignIn(page, ADMIN.email, 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('an admin signs in, browses the athletes list, reloads into the same view, and signs out', async ({
  page,
  baseURL,
}) => {
  const foreign = recordThirdPartyRequests(page, baseURL!);

  // Sent to sign-in from a deep link; signing in returns to it.
  await page.goto('/athletes?sort=-createdAt');
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await submitSignIn(page, ADMIN.email, PASSWORD);
  await expect(page).toHaveURL(/\/athletes\?sort=-createdAt$/);

  // The shell: the page title, the active academy, the role's menu, who is signed in.
  await expect(page.getByRole('heading', { name: 'Athletes' })).toBeVisible();
  await expect(page.getByTestId('active-academy')).toHaveText('Alpha Academy');
  await expect(page.getByRole('link', { name: 'Athletes' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(ADMIN.name);

  const rows = page.locator('tbody tr');
  await expect(page.getByRole('columnheader', { name: 'Added' })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  await expect(rows).toHaveCount(25);

  // Search: debounced into the URL, and the API does the matching.
  await page.getByRole('searchbox', { name: 'Search athletes' }).fill('falcon');
  await expect(page).toHaveURL(/q=falcon/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Falcon');
  await expect(page.getByTestId('data-table-total')).toHaveText('1 athlete');

  // Clearing the search returns to the full list.
  await page.getByRole('searchbox', { name: 'Search athletes' }).fill('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(rows).toHaveCount(25);

  // Sort by a column, then page.
  await page.getByRole('button', { name: 'First name' }).click();
  await expect(page).toHaveURL(/sort=firstName/);
  await expect(page.getByRole('columnheader', { name: 'First name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await page.getByRole('button', { name: 'Go to next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByTestId('data-table-page')).toHaveText('Page 2 of 2');
  const secondPage = await rows.allInnerTexts();
  expect(secondPage.length).toBeGreaterThan(0);

  // The view is the URL: a reload shows the same page, sort and rows.
  await page.reload();
  await expect(page).toHaveURL(/sort=firstName/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByTestId('data-table-page')).toHaveText('Page 2 of 2');
  await expect(page.getByRole('columnheader', { name: 'First name' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(rows).toHaveCount(secondPage.length);
  expect(await rows.allInnerTexts()).toEqual(secondPage);

  // Sign out: back to sign-in, and the session is really gone.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/athletes');
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);

  expect(foreign, 'requests to another host').toEqual([]);
});
