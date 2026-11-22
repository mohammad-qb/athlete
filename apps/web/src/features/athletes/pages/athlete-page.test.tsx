import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AthleteResponse } from '@/lib/api';
import { AthletePage } from './athlete-page';

const getAthlete = vi.hoisted(() => vi.fn());
const updateAthlete = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    athletesGetByIdOptions: (options: Parameters<typeof original.athletesGetByIdOptions>[0]) => ({
      ...original.athletesGetByIdOptions(options),
      queryFn: () => getAthlete() as Promise<AthleteResponse>,
    }),
    athletesUpdateMutation: () => ({
      mutationFn: (variables: unknown) => updateAthlete(variables) as Promise<AthleteResponse>,
    }),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
const permissions = vi.hoisted(() => ({ update: true }));
vi.mock('@/lib/authz', () => ({ useCan: () => () => permissions.update }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const ID = '44444444-4444-4444-4444-444444444444';
const LOADED: AthleteResponse = {
  id: ID,
  academyId: '11111111-1111-1111-1111-111111111111',
  firstName: 'Amal',
  lastName: 'Falcon',
  dateOfBirth: '2008-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  version: 3,
};
/** What someone else saved in the meantime. */
const THEIRS: AthleteResponse = { ...LOADED, lastName: 'Hawk', version: 4 };

const staleWrite = () =>
  new ApiError({ status: 409, type: 'CONFLICT', code: 'stale_write', message: 'stale' });

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AthletePage athleteId={ID} />
    </QueryClientProvider>,
  );
  await screen.findByLabelText('First name');
  return userEvent.setup();
}

async function retype(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  await user.clear(screen.getByLabelText(label));
  await user.type(screen.getByLabelText(label), text);
}

describe('AthletePage', () => {
  beforeEach(() => {
    getAthlete.mockReset().mockResolvedValue(LOADED);
    updateAthlete.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
    permissions.update = true;
  });

  it('saves only the fields that changed, against the version it loaded', async () => {
    updateAthlete.mockResolvedValue({ ...LOADED, firstName: 'Amala', version: 4 });
    const user = await renderPage();
    await retype(user, 'First name', 'Amala');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Athlete saved.'));
    expect(updateAthlete).toHaveBeenCalledExactlyOnceWith({
      path: { id: ID },
      headers: { 'If-Match': '"3"' },
      body: { firstName: 'Amala' },
    });
    expect(screen.getByTestId('athlete-name')).toHaveTextContent('Amala Falcon');
  });

  it('sends nothing when nothing changed', async () => {
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
    expect(updateAthlete).not.toHaveBeenCalled();
  });

  it('refuses an empty field before asking the server', async () => {
    const user = await renderPage();
    await user.clear(screen.getByLabelText('Last name'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Required.');
    expect(updateAthlete).not.toHaveBeenCalled();
  });

  it("puts the server's validation messages on the fields they name, keeping what was typed", async () => {
    updateAthlete.mockRejectedValue(
      new ApiError({
        status: 400,
        type: 'VALIDATION',
        code: 'validation_failed',
        message: 'Validation failed',
        fields: [
          { in: 'body', path: 'dateOfBirth', messages: ['must not be in the future'] },
          { in: 'body', path: 'firstName', messages: ['is not allowed'] },
        ],
      }),
    );
    const user = await renderPage();
    await retype(user, 'First name', 'Amala');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getByLabelText('Date of birth')).toHaveAccessibleDescription(
      'must not be in the future',
    );
    expect(screen.getByLabelText('First name')).toHaveAccessibleDescription('is not allowed');
    expect(screen.getByLabelText('First name')).toHaveValue('Amala');
    expect(screen.getByLabelText('Last name')).not.toHaveAccessibleDescription();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe('when someone else saved first (409 stale_write)', () => {
    async function saveIntoConflict() {
      updateAthlete.mockRejectedValueOnce(staleWrite());
      const user = await renderPage();
      await retype(user, 'First name', 'Amala');
      // The dialog's fetch of the record as it is now.
      getAthlete.mockResolvedValue(THEIRS);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const dialog = await screen.findByRole('dialog');
      return { user, dialog };
    }

    it('shows their change beside mine and leaves the form filled in', async () => {
      const { dialog } = await saveIntoConflict();

      const lastName = within(dialog).getByTestId('conflict-lastName');
      expect(within(lastName).getByTestId('conflict-theirs')).toHaveTextContent('Hawk');
      expect(within(lastName).getByTestId('conflict-mine')).toHaveTextContent('Falcon');
      expect(within(dialog).getByTestId('conflict-firstName')).toBeInTheDocument();
      expect(within(dialog).queryByTestId('conflict-dateOfBirth')).not.toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('"Keep mine" saves the form again, against their version', async () => {
      const { user, dialog } = await saveIntoConflict();
      updateAthlete.mockResolvedValue({ ...THEIRS, firstName: 'Amala', lastName: 'Falcon', version: 5 });
      await user.click(within(dialog).getByRole('button', { name: 'Keep mine' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(updateAthlete).toHaveBeenLastCalledWith({
        path: { id: ID },
        headers: { 'If-Match': '"4"' },
        // Everything the form says that their version does not.
        body: { firstName: 'Amala', lastName: 'Falcon' },
      });
      expect(screen.getByTestId('athlete-name')).toHaveTextContent('Amala Falcon');
      expect(toast.success).toHaveBeenCalledWith('Athlete saved.');
    });

    it('"Take theirs" fills the form with their version and saves nothing', async () => {
      const { user, dialog } = await saveIntoConflict();
      await user.click(within(dialog).getByRole('button', { name: 'Take theirs' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(updateAthlete).toHaveBeenCalledOnce();
      expect(screen.getByLabelText('First name')).toHaveValue('Amal');
      expect(screen.getByLabelText('Last name')).toHaveValue('Hawk');

      // The next save is made against the version that was taken.
      updateAthlete.mockResolvedValue({ ...THEIRS, firstName: 'Amira', version: 5 });
      await retype(user, 'First name', 'Amira');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(updateAthlete).toHaveBeenCalledTimes(2));
      expect(updateAthlete).toHaveBeenLastCalledWith({
        path: { id: ID },
        headers: { 'If-Match': '"4"' },
        body: { firstName: 'Amira' },
      });
    });
  });

  it('is read-only for someone who may not update athletes', async () => {
    permissions.update = false;
    await renderPage();

    expect(screen.getByLabelText('First name')).toBeDisabled();
    expect(screen.getByLabelText('Date of birth')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('says so when the athlete cannot be loaded, and offers the way back', async () => {
    getAthlete.mockRejectedValue(new ApiError({ status: 404, type: 'NOT_FOUND', message: 'nope' }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AthletePage athleteId={ID} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/);
    expect(screen.getByRole('link', { name: 'Athletes' })).toHaveAttribute('href', '/athletes');
  });
});
