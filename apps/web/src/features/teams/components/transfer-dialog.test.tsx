import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type TeamResponse } from '@/lib/api';
import { TransferDialog } from './transfer-dialog';

const listTeams = vi.hoisted(() => vi.fn());
const transfer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    teamsListOptions: (options: Parameters<typeof original.teamsListOptions>[0]) => ({
      ...original.teamsListOptions(options),
      queryFn: () => listTeams() as Promise<{ items: TeamResponse[] }>,
    }),
    teamsTransferMutation: () => ({
      mutationFn: (variables: unknown) => transfer(variables) as Promise<unknown>,
    }),
  };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  today: () => '2026-04-01',
}));

const ACADEMY = '11111111-1111-1111-1111-111111111111';
const ATHLETE = '44444444-4444-4444-4444-444444444444';
const TEAM_A: TeamResponse = {
  id: '66666666-6666-6666-6666-666666666666',
  academyId: ACADEMY,
  name: 'Team A',
  sport: 'football',
  ageGroup: null,
  version: 0,
};
const TEAM_B: TeamResponse = { ...TEAM_A, id: '77777777-7777-7777-7777-777777777777', name: 'Team B' };

function renderDialog() {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TransferDialog
        team={TEAM_A}
        entry={{ athleteId: ATHLETE, fullName: 'Amal Falcon' }}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
}

describe('TransferDialog', () => {
  beforeEach(() => {
    listTeams.mockReset().mockResolvedValue({ items: [TEAM_A, TEAM_B], total: 2, page: 1, pageSize: 20 });
    transfer.mockReset();
    Object.values(toast).forEach((mock) => mock.mockReset());
  });

  it('offers every team except the one the athlete is leaving', async () => {
    renderDialog();

    expect(await screen.findByRole('option', { name: /Team B/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Team A/ })).not.toBeInTheDocument();
  });

  it('asks for a destination before sending anything', async () => {
    const { user } = renderDialog();
    await screen.findByRole('option', { name: /Team B/ });
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Required.');
    expect(transfer).not.toHaveBeenCalled();
  });

  it('transfers the athlete to the chosen team from the chosen day, then closes', async () => {
    transfer.mockResolvedValue({
      closed: { teamId: TEAM_A.id },
      opened: { teamId: TEAM_B.id },
    });
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('option', { name: /Team B/ }));
    expect(screen.getByTestId('picker-value')).toHaveTextContent('Team B');
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(transfer).toHaveBeenCalledExactlyOnceWith({
      body: {
        athleteId: ATHLETE,
        fromTeamId: TEAM_A.id,
        toTeamId: TEAM_B.id,
        effectiveAt: new Date(2026, 3, 1).toISOString(),
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Amal Falcon transferred to Team B.');
  });

  it("shows the API's own words when the database's temporal rule refuses the move", async () => {
    transfer.mockRejectedValue(
      new ApiError({
        status: 409,
        type: 'CONFLICT',
        code: 'membership_overlap',
        message: 'The athlete is already on this team during that period',
      }),
    );
    const { user, onClose } = renderDialog();
    await user.click(await screen.findByRole('option', { name: /Team B/ }));
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'The athlete is already on this team during that period',
      ),
    );
    // Still open, still filled in: the person can pick another day.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('picker-value')).toHaveTextContent('Team B');
  });
});
