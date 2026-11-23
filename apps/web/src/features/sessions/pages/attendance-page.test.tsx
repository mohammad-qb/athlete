import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type ParticipationResponse,
  type RosterEntry,
  type SessionResponse,
} from '@/lib/api';
import { resetSession } from '@/lib/session-reset';
import { AttendancePage } from './attendance-page';

const getRegister = vi.hoisted(() => vi.fn());
const record = vi.hoisted(() => vi.fn());
const fixtures = vi.hoisted((): { session: unknown; roster: unknown } => ({
  session: undefined,
  roster: undefined,
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    sessionsGetByIdOptions: (options: Parameters<typeof original.sessionsGetByIdOptions>[0]) => ({
      ...original.sessionsGetByIdOptions(options),
      queryFn: () => Promise.resolve(fixtures.session as SessionResponse),
    }),
    teamsGetByIdOptions: (options: Parameters<typeof original.teamsGetByIdOptions>[0]) => ({
      ...original.teamsGetByIdOptions(options),
      queryFn: () => Promise.resolve({ name: 'Team A' }),
    }),
    teamsRosterOptions: (options: Parameters<typeof original.teamsRosterOptions>[0]) => ({
      ...original.teamsRosterOptions(options),
      queryFn: () => Promise.resolve(fixtures.roster as RosterEntry[]),
    }),
    sessionsRegisterOptions: (options: Parameters<typeof original.sessionsRegisterOptions>[0]) => ({
      ...original.sessionsRegisterOptions(options),
      queryFn: () => getRegister() as Promise<ParticipationResponse[]>,
    }),
    sessionsRecordAttendanceMutation: () => ({
      mutationFn: (variables: unknown) => record(variables) as Promise<ParticipationResponse[]>,
    }),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
const permissions = vi.hoisted(() => ({ record: true }));
vi.mock('@/lib/authz', () => ({
  useCan: () => () => permissions.record,
  useMe: () => ({
    user: { id: 'user-1' },
    activeAcademyId: '11111111-1111-1111-1111-111111111111',
  }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const ACADEMY = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '55555555-5555-5555-5555-555555555555';
const TEAM = '66666666-6666-6666-6666-666666666666';
const AMAL = '44444444-4444-4444-4444-444444444441';
const BILAL = '44444444-4444-4444-4444-444444444442';
const SESSION: SessionResponse = {
  id: SESSION_ID,
  academyId: ACADEMY,
  teamId: TEAM,
  startsAt: '2026-03-02T17:00:00.000Z',
  endsAt: '2026-03-02T18:30:00.000Z',
  location: 'Pitch 2',
};
const ROSTER: RosterEntry[] = [
  { athleteId: AMAL, fullName: 'Amal Falcon' },
  { athleteId: BILAL, fullName: 'Bilal Oryx' },
];

function stored(athleteId: string, status: ParticipationResponse['status']): ParticipationResponse {
  return {
    id: `entry-${athleteId}`,
    academyId: ACADEMY,
    sessionId: SESSION_ID,
    athleteId,
    teamIdAtTime: TEAM,
    status,
    note: null,
    recordedAt: '2026-03-02T17:05:00Z',
  };
}

/** Draws the register; returns a way to throw it away and draw it again, as a reload does. */
async function renderPage() {
  const page = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return {
      queryClient,
      ...render(
        <QueryClientProvider client={queryClient}>
          <AttendancePage sessionId={SESSION_ID} />
        </QueryClientProvider>,
      ),
    };
  };
  const settled = async () => {
    await screen.findByTestId('session-team');
    await waitFor(() => expect(screen.queryByTestId('register-loading')).not.toBeInTheDocument());
  };
  let current = page();
  await settled();
  return {
    user: userEvent.setup(),
    queryClient: () => current.queryClient,
    reload: async () => {
      current.unmount();
      current = page();
      await settled();
    },
  };
}

const choice = (athlete: string, status: string) =>
  within(screen.getByRole('radiogroup', { name: `Attendance for ${athlete}` })).getByRole('radio', {
    name: status,
  });
const progress = () => screen.getByTestId('register-progress');
const submitButton = () => screen.getByRole('button', { name: /Submit register|Try again/ });
const sentEntries = (call: number) =>
  (record.mock.calls[call]![0] as { body: { entries: { clientRecordId: string }[] } }).body.entries;

describe('AttendancePage', () => {
  beforeEach(() => {
    fixtures.session = SESSION;
    fixtures.roster = ROSTER;
    getRegister.mockReset().mockResolvedValue([]);
    record.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
    permissions.record = true;
  });

  it('counts the marks, and submits only once everyone is marked', async () => {
    const { user } = await renderPage();
    expect(progress()).toHaveTextContent('0 of 2 marked');
    expect(submitButton()).toBeDisabled();

    await user.click(choice('Amal Falcon', 'Late'));
    expect(progress()).toHaveTextContent('1 of 2 marked');
    expect(submitButton()).toBeDisabled();

    await user.click(choice('Bilal Oryx', 'Absent'));
    expect(progress()).toHaveTextContent('2 of 2 marked');
    expect(submitButton()).toBeEnabled();
  });

  it('restores the marks and the note after a reload', async () => {
    const { user, reload } = await renderPage();
    await user.click(choice('Amal Falcon', 'Late'));
    await user.click(screen.getByRole('button', { name: 'Add a note for Amal Falcon' }));
    await user.type(screen.getByLabelText('Note for Amal Falcon'), 'bus');

    await reload();

    expect(choice('Amal Falcon', 'Late')).toBeChecked();
    expect(screen.getByLabelText('Note for Amal Falcon')).toHaveValue('bus');
    expect(choice('Bilal Oryx', 'Present')).not.toBeChecked();
    expect(progress()).toHaveTextContent('1 of 2 marked');
  });

  it('marks everyone still unmarked as present, leaving the marks already made', async () => {
    const { user } = await renderPage();
    await user.click(choice('Amal Falcon', 'Excused'));
    await user.click(screen.getByRole('button', { name: 'Mark rest present' }));

    expect(choice('Amal Falcon', 'Excused')).toBeChecked();
    expect(choice('Bilal Oryx', 'Present')).toBeChecked();
    expect(progress()).toHaveTextContent('2 of 2 marked');
  });

  it('submits once, shows the entries as recorded and forgets the draft', async () => {
    record.mockResolvedValue([stored(AMAL, 'late'), stored(BILAL, 'present')]);
    getRegister.mockResolvedValueOnce([]).mockResolvedValue([stored(AMAL, 'late'), stored(BILAL, 'present')]);
    const { user } = await renderPage();
    await user.click(choice('Amal Falcon', 'Late'));
    await user.click(choice('Bilal Oryx', 'Present'));
    await user.click(submitButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Register submitted.'));
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![0]).toMatchObject({
      path: { id: SESSION_ID },
      body: {
        entries: [
          { athleteId: AMAL, status: 'late', note: null },
          { athleteId: BILAL, status: 'present', note: null },
        ],
      },
    });
    const recorded = screen.getByRole('list', { name: 'Recorded attendance' });
    expect(within(recorded).getByText('Amal Falcon')).toBeInTheDocument();
    expect(within(recorded).getByText('Late')).toBeInTheDocument();
    expect(screen.getByTestId('recorded-summary')).toHaveTextContent('2 athletes, the whole register');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps the marks when a submission fails, and sends the same ids when tried again', async () => {
    record
      .mockRejectedValueOnce(
        new ApiError({ status: 0, type: 'UNKNOWN', code: 'network_error', message: 'offline' }),
      )
      .mockResolvedValue([stored(AMAL, 'present'), stored(BILAL, 'absent')]);
    const { user, reload } = await renderPage();
    await user.click(choice('Amal Falcon', 'Present'));
    await user.click(choice('Bilal Oryx', 'Absent'));
    await user.click(submitButton());

    expect(await screen.findByText('Not submitted. Your marks are kept; try again.')).toBeVisible();
    expect(toast.error).toHaveBeenCalledWith('offline');
    expect(choice('Bilal Oryx', 'Absent')).toBeChecked();
    expect(window.localStorage.length).toBe(1);

    // Even across a reload between the two attempts.
    await reload();
    await user.click(submitButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Register submitted.'));
    expect(record).toHaveBeenCalledTimes(2);
    const first = sentEntries(0).map((entry) => entry.clientRecordId);
    expect(new Set(first).size).toBe(2);
    expect(sentEntries(1).map((entry) => entry.clientRecordId)).toEqual(first);
  });

  it('reloads the register when someone else has recorded part of it meanwhile', async () => {
    record.mockRejectedValue(
      new ApiError({
        status: 409,
        type: 'CONFLICT',
        code: 'attendance_already_recorded',
        message: 'Attendance is already recorded for an athlete in this register',
      }),
    );
    getRegister.mockResolvedValueOnce([]).mockResolvedValue([stored(AMAL, 'absent')]);
    const { user } = await renderPage();
    await user.click(choice('Amal Falcon', 'Present'));
    await user.click(choice('Bilal Oryx', 'Late'));
    await user.click(submitButton());

    // Amal is now shown as the other person recorded her; Bilal's mark is still here to send.
    const recorded = await screen.findByRole('list', { name: 'Recorded attendance' });
    expect(within(recorded).getByText('Absent')).toBeInTheDocument();
    expect(choice('Bilal Oryx', 'Late')).toBeChecked();
    expect(progress()).toHaveTextContent('1 of 1 marked');
    expect(screen.getByText(/This register changed while you were marking it/)).toBeVisible();
  });

  it('drops a mark for someone already recorded: a lost answer, then a reload', async () => {
    const { user, reload } = await renderPage();
    await user.click(choice('Amal Falcon', 'Present'));
    getRegister.mockResolvedValue([stored(AMAL, 'present')]);

    await reload();

    expect(screen.queryByRole('radiogroup', { name: 'Attendance for Amal Falcon' })).toBeNull();
    expect(progress()).toHaveTextContent('0 of 1 marked');
    await waitFor(() => expect(window.localStorage.length).toBe(0));
  });

  it('loses the draft with the session: a sign-out or academy switch leaves nothing behind', async () => {
    const { user, queryClient } = await renderPage();
    await user.click(choice('Amal Falcon', 'Present'));
    expect(window.localStorage.length).toBe(1);

    resetSession(queryClient());

    expect(window.localStorage.length).toBe(0);
  });

  it('shows the register read-only to someone who may not record attendance', async () => {
    permissions.record = false;
    getRegister.mockResolvedValue([stored(AMAL, 'present')]);
    await renderPage();

    expect(screen.getByRole('list', { name: 'Athletes not recorded' })).toHaveTextContent('Bilal Oryx');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit register/ })).not.toBeInTheDocument();
  });

  it('says so when nobody was on the team at the start of the session', async () => {
    fixtures.roster = [];
    await renderPage();
    expect(screen.getByText(/Nobody was on this team when the session started/)).toBeVisible();
  });
});
