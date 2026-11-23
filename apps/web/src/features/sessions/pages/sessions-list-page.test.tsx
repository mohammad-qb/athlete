import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/lib/api';
import { SessionsListPage } from './sessions-list-page';

const listSessions = vi.hoisted(() => vi.fn());
const getTeam = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    sessionsListOptions: (options: Parameters<typeof original.sessionsListOptions>[0]) => ({
      ...original.sessionsListOptions(options),
      queryFn: () => listSessions() as Promise<{ items: SessionResponse[]; total: number }>,
    }),
    teamsGetByIdOptions: (options: Parameters<typeof original.teamsGetByIdOptions>[0]) => ({
      ...original.teamsGetByIdOptions(options),
      queryFn: () => getTeam(options.path.id) as Promise<{ name: string }>,
    }),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/session">{children}</a>,
}));
vi.mock('@/lib/authz', () => ({ Can: () => null }));

const ACADEMY = '11111111-1111-1111-1111-111111111111';
const TEAM_A = '66666666-6666-6666-6666-666666666666';
const TEAM_B = '77777777-7777-7777-7777-777777777777';

function session(id: string, teamId: string, hour: number): SessionResponse {
  return {
    id,
    academyId: ACADEMY,
    teamId,
    startsAt: new Date(2026, 2, 2, hour, 0).toISOString(),
    endsAt: new Date(2026, 2, 2, hour + 1, 0).toISOString(),
    location: null,
  };
}

describe('SessionsListPage', () => {
  beforeEach(() => {
    listSessions.mockReset();
    getTeam
      .mockReset()
      .mockImplementation((id: string) =>
        Promise.resolve({ name: id === TEAM_A ? 'Team A' : 'Team B' }),
      );
  });

  it("names each session's team by asking for that team, once per team on the page", async () => {
    listSessions.mockResolvedValue({
      items: [session('s1', TEAM_A, 9), session('s2', TEAM_A, 11), session('s3', TEAM_B, 13)],
      total: 3,
      page: 1,
      pageSize: 25,
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })}
      >
        <SessionsListPage
          search={{ page: 1, pageSize: 25, sort: '-startsAt', show: 'all' }}
          onSearchChange={() => {}}
        />
      </QueryClientProvider>,
    );

    // Each name is drawn twice per row: its own column, and under the time for phones.
    expect(await screen.findAllByText('Team A')).toHaveLength(4);
    expect(await screen.findAllByText('Team B')).toHaveLength(2);
    // Not a page of the teams list (which stops at 100 teams): the teams on screen.
    expect(getTeam.mock.calls.map(([id]) => id as string).sort()).toEqual([TEAM_A, TEAM_B]);
  });
});
