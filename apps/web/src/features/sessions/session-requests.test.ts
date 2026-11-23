import { describe, expect, it } from 'vitest';
import {
  formatSessionTime,
  sessionFormErrors,
  sessionsQuery,
  type SessionValues,
  toSessionRequest,
} from './session-requests';

const TEAM = { id: '66666666-6666-6666-6666-666666666666', label: 'Team A' };
const FILLED: SessionValues = {
  team: TEAM,
  date: '2026-03-02',
  startTime: '17:00',
  endTime: '18:30',
  location: ' Pitch 2 ',
};

describe('the session form', () => {
  it('sends a day and two clock times as instants in the local zone', () => {
    expect(toSessionRequest(FILLED)).toEqual({
      teamId: TEAM.id,
      startsAt: new Date(2026, 2, 2, 17, 0).toISOString(),
      endsAt: new Date(2026, 2, 2, 18, 30).toISOString(),
      location: 'Pitch 2',
    });
    expect(sessionFormErrors(FILLED)).toBeUndefined();
  });

  it('sends an empty location as none', () => {
    expect(toSessionRequest({ ...FILLED, location: '  ' }).location).toBeNull();
  });

  it('asks for whatever is missing, on the field it is missing from', () => {
    expect(
      sessionFormErrors({ team: null, date: '', startTime: '', endTime: '', location: '' }),
    ).toEqual({
      fields: { team: 'Required.', date: 'Required.', startTime: 'Required.', endTime: 'Required.' },
    });
    // The day is half of each instant, but a missing day is the day's problem alone.
    expect(sessionFormErrors({ ...FILLED, date: '' })).toEqual({ fields: { date: 'Required.' } });
  });

  it('refuses a session that does not end after it starts', () => {
    const message = 'The session must end after it starts.';
    expect(sessionFormErrors({ ...FILLED, endTime: '16:00' })).toEqual({
      fields: { endTime: message },
    });
    expect(sessionFormErrors({ ...FILLED, endTime: '17:00' })).toEqual({
      fields: { endTime: message },
    });
  });

  it('refuses a location longer than the contract allows', () => {
    expect(sessionFormErrors({ ...FILLED, location: 'x'.repeat(201) })).toEqual({
      fields: { location: 'Use at most 200 characters.' },
    });
  });
});

describe('the sessions list', () => {
  const search = { page: 2, pageSize: 25, sort: '-startsAt', show: 'recent' } as const;

  it('by default asks for what is coming up and the last two weeks', () => {
    expect(sessionsQuery(search, '2026-03-20')).toEqual({
      page: 2,
      pageSize: 25,
      sort: '-startsAt',
      from: new Date(2026, 2, 6).toISOString(),
    });
  });

  it('asks for everything when told to', () => {
    expect(sessionsQuery({ ...search, show: 'all' }, '2026-03-20')).toEqual({
      page: 2,
      pageSize: 25,
      sort: '-startsAt',
    });
  });

  it('shows a session as its day and its start and end on the clock', () => {
    expect(
      formatSessionTime({
        startsAt: new Date(2026, 2, 2, 17, 0).toISOString(),
        endsAt: new Date(2026, 2, 2, 18, 30).toISOString(),
      }),
    ).toBe('Mon 2 Mar 2026, 17:00–18:30');
  });

  it('names the end day of a session that runs past midnight', () => {
    expect(
      formatSessionTime({
        startsAt: new Date(2026, 2, 2, 23, 0).toISOString(),
        endsAt: new Date(2026, 2, 3, 1, 0).toISOString(),
      }),
    ).toBe('Mon 2 Mar 2026, 23:00–Tue 3 Mar 2026, 01:00');
  });
});
