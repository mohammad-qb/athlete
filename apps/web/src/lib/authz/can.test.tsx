import type { GrantedPermission, MeResponse } from '@athlete/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { meReadOptions } from '../api';
import { can } from './can';
import { Can } from './can.component';

const coach: GrantedPermission[] = [
  { action: 'read', subject: 'athletes' },
  { action: 'read', subject: 'trainingSessions' },
  { action: 'create', subject: 'trainingSessions' },
];

describe('can', () => {
  it('answers yes only for a pair that is in the list', () => {
    expect(can(coach, 'read', 'athletes')).toBe(true);
    expect(can(coach, 'create', 'trainingSessions')).toBe(true);
  });

  it('does not infer one action from another, or one subject from another', () => {
    expect(can(coach, 'create', 'athletes')).toBe(false);
    expect(can(coach, 'update', 'athletes')).toBe(false);
    expect(can(coach, 'read', 'teams')).toBe(false);
  });

  it('answers no to everything for an account with no academy', () => {
    expect(can([], 'read', 'athletes')).toBe(false);
  });
});

function withMe(permissions: GrantedPermission[], children: ReactNode) {
  const me: MeResponse = {
    user: { id: '00000000-0000-0000-0000-000000000001', email: 'coach@alpha.test', name: 'Coach' },
    activeAcademyId: '11111111-1111-1111-1111-111111111111',
    academies: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Alpha', roles: ['coach'] }],
    permissions,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(meReadOptions().queryKey, me);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('<Can>', () => {
  it('draws its children when /me lists the pair', () => {
    render(
      withMe(
        coach,
        <Can action="create" subject="trainingSessions">
          <button>New session</button>
        </Can>,
      ),
    );
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
  });

  it('draws nothing, or the fallback, when it does not', () => {
    render(
      withMe(
        coach,
        <>
          <Can action="create" subject="athletes">
            <button>New athlete</button>
          </Can>
          <Can action="update" subject="athletes" fallback={<span>Read only</span>}>
            <button>Edit</button>
          </Can>
        </>,
      ),
    );
    expect(screen.queryByRole('button', { name: 'New athlete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
