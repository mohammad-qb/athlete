import {
  CreateMembershipRequest,
  CreateTeamRequest,
  TransferAthleteRequest,
} from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import {
  membershipPeriodError,
  toMembershipRequest,
  toTeamRequest,
  toTransferRequest,
} from './team-requests';

const ATHLETE = '44444444-4444-4444-4444-444444444444';
const TEAM_A = '66666666-6666-6666-6666-666666666666';
const TEAM_B = '77777777-7777-7777-7777-777777777777';

describe('toTeamRequest', () => {
  it('sends an empty age group as null, which is what the contract means by "none"', () => {
    const request = toTeamRequest({ name: ' U17 Squad ', sport: 'football', ageGroup: '  ' });
    expect(request).toEqual({ name: 'U17 Squad', sport: 'football', ageGroup: null });
    expect(CreateTeamRequest.safeParse(request).success).toBe(true);
  });
});

describe('toMembershipRequest', () => {
  it('ends the period, exclusively, at the start of the day after the last day', () => {
    const request = toMembershipRequest({
      athlete: { id: ATHLETE, label: 'Amal Falcon' },
      validFrom: '2026-03-01',
      validTo: '2026-06-30',
    });
    expect(request).toEqual({
      athleteId: ATHLETE,
      validFrom: new Date(2026, 2, 1).toISOString(),
      validTo: new Date(2026, 6, 1).toISOString(),
    });
    expect(CreateMembershipRequest.safeParse(request).success).toBe(true);
  });

  it('leaves a membership with no last day open-ended', () => {
    const request = toMembershipRequest({
      athlete: { id: ATHLETE, label: 'Amal Falcon' },
      validFrom: '2026-03-01',
      validTo: '',
    });
    expect(request.validTo).toBeNull();
  });

  it('builds a request the contract refuses when nobody is chosen', () => {
    const request = toMembershipRequest({ athlete: null, validFrom: '2026-03-01', validTo: '' });
    const result = CreateMembershipRequest.safeParse(request);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['athleteId']);
  });
});

describe('membershipPeriodError', () => {
  const athlete = { id: ATHLETE, label: 'Amal Falcon' };

  it('refuses a last day before the first', () => {
    expect(
      membershipPeriodError({ athlete, validFrom: '2026-03-02', validTo: '2026-03-01' }),
    ).toMatch(/cannot be before/);
  });

  it('allows a one-day membership and an open-ended one', () => {
    expect(membershipPeriodError({ athlete, validFrom: '2026-03-01', validTo: '2026-03-01' })).toBeUndefined();
    expect(membershipPeriodError({ athlete, validFrom: '2026-03-01', validTo: '' })).toBeUndefined();
  });
});

describe('toTransferRequest', () => {
  const move = { athleteId: ATHLETE, fromTeamId: TEAM_A };

  it('names the athlete, both teams and the instant the chosen day starts', () => {
    const request = toTransferRequest(
      { toTeam: { id: TEAM_B, label: 'Team B' }, effectiveAt: '2026-04-01' },
      move,
    );
    expect(request).toEqual({
      athleteId: ATHLETE,
      fromTeamId: TEAM_A,
      toTeamId: TEAM_B,
      effectiveAt: new Date(2026, 3, 1).toISOString(),
    });
    expect(TransferAthleteRequest.safeParse(request).success).toBe(true);
  });

  it('builds a request the contract refuses without a destination or a date', () => {
    const result = TransferAthleteRequest.safeParse(
      toTransferRequest({ toTeam: null, effectiveAt: '' }, move),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual([
      'effectiveAt',
      'toTeamId',
    ]);
  });
});
