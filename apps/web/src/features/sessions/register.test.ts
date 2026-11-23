import { RecordAttendanceRequest } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import type { ParticipationResponse, RosterEntry } from '@/lib/api';
import { type AttendanceDraft, markAthlete } from '@/lib/drafts';
import { buildRegister, mergeEntries, toAttendanceRequest, withoutRecorded } from './register';

const ACADEMY = '11111111-1111-1111-1111-111111111111';
const SESSION = '55555555-5555-5555-5555-555555555555';
const TEAM = '66666666-6666-6666-6666-666666666666';
const [AMAL, BILAL, CARA, DANA] = [
  '44444444-4444-4444-4444-444444444441',
  '44444444-4444-4444-4444-444444444442',
  '44444444-4444-4444-4444-444444444443',
  '44444444-4444-4444-4444-444444444444',
] as const;

const ROSTER: RosterEntry[] = [
  { athleteId: AMAL, fullName: 'Amal Falcon' },
  { athleteId: BILAL, fullName: 'Bilal Oryx' },
  { athleteId: CARA, fullName: 'Cara Lynx' },
  { athleteId: DANA, fullName: 'Dana Ibex' },
];

function entry(athleteId: string, status: ParticipationResponse['status']): ParticipationResponse {
  return {
    id: `entry-${athleteId}`,
    academyId: ACADEMY,
    sessionId: SESSION,
    athleteId,
    teamIdAtTime: TEAM,
    status,
    note: null,
    recordedAt: '2026-03-01T17:00:00Z',
  };
}

/** A draft with the given marks, whose ids are predictable: `id-<athlete>`. */
function draftOf(marks: Record<string, Parameters<typeof markAthlete>[2]>): AttendanceDraft {
  return Object.entries(marks).reduce<AttendanceDraft>(
    (draft, [athleteId, change]) => markAthlete(draft, athleteId, change, () => `id-${athleteId}`),
    {},
  );
}

describe('buildRegister', () => {
  it('counts who is marked out of who is still to record', () => {
    const register = buildRegister(
      ROSTER,
      [],
      draftOf({ [AMAL]: { status: 'present' }, [BILAL]: { status: 'late' } }),
    );
    expect(register.pending.map((row) => row.fullName)).toEqual([
      'Amal Falcon',
      'Bilal Oryx',
      'Cara Lynx',
      'Dana Ibex',
    ]);
    expect(register.marked).toBe(2);
    expect(register.complete).toBe(false);
    expect(register.recorded).toEqual([]);
  });

  it('does not count a note without a status as marked', () => {
    const register = buildRegister(ROSTER, [], draftOf({ [AMAL]: { note: 'limping' } }));
    expect(register.marked).toBe(0);
  });

  it('is complete once everyone still to record has a status', () => {
    const everyone = draftOf(
      Object.fromEntries(ROSTER.map((athlete) => [athlete.athleteId, { status: 'present' }])),
    );
    expect(buildRegister(ROSTER, [], everyone).complete).toBe(true);
  });

  it('takes an athlete the API holds out of what is to mark, whatever the draft says', () => {
    const register = buildRegister(
      ROSTER,
      [entry(AMAL, 'absent')],
      draftOf({ [AMAL]: { status: 'present' }, [BILAL]: { status: 'late' } }),
    );
    expect(register.recorded).toEqual([
      { athleteId: AMAL, fullName: 'Amal Falcon', status: 'absent', note: null },
    ]);
    expect(register.pending.map((row) => row.athleteId)).toEqual([BILAL, CARA, DANA]);
    // Out of three now, and only Bilal's mark counts.
    expect(register.marked).toBe(1);
  });

  it('has nothing to submit when everyone is recorded, or nobody was on the team', () => {
    const all = ROSTER.map((athlete) => entry(athlete.athleteId, 'present'));
    expect(buildRegister(ROSTER, all, {})).toMatchObject({ pending: [], complete: false });
    expect(buildRegister([], [], {})).toMatchObject({ pending: [], recorded: [], complete: false });
  });

  it('still shows an entry whose athlete is not on the roster it was given', () => {
    const register = buildRegister([ROSTER[0]!], [entry(BILAL, 'present')], {});
    expect(register.recorded).toEqual([
      { athleteId: BILAL, fullName: 'Athlete not on this roster', status: 'present', note: null },
    ]);
  });
});

describe('toAttendanceRequest', () => {
  it('sends one entry per marked athlete, under the id the mark was given', () => {
    const { pending } = buildRegister(
      ROSTER.slice(0, 2),
      [],
      draftOf({ [AMAL]: { status: 'late', note: '  bus  ' }, [BILAL]: { status: 'present' } }),
    );
    expect(toAttendanceRequest(pending)).toEqual({
      entries: [
        { clientRecordId: `id-${AMAL}`, athleteId: AMAL, status: 'late', note: 'bus' },
        { clientRecordId: `id-${BILAL}`, athleteId: BILAL, status: 'present', note: null },
      ],
    });
  });

  it('builds the same request again from the same draft: a retry repeats the ids', () => {
    const draft = draftOf({ [AMAL]: { status: 'present' }, [BILAL]: { status: 'absent' } });
    const first = toAttendanceRequest(buildRegister(ROSTER.slice(0, 2), [], draft).pending);
    const again = toAttendanceRequest(buildRegister(ROSTER.slice(0, 2), [], draft).pending);
    expect(again).toEqual(first);
  });

  it('never sends an athlete who is already recorded, or one with no status', () => {
    const { pending } = buildRegister(
      ROSTER,
      [entry(AMAL, 'present')],
      draftOf({ [AMAL]: { status: 'late' }, [BILAL]: { status: 'late' }, [CARA]: { note: 'x' } }),
    );
    expect(toAttendanceRequest(pending).entries.map((sent) => sent.athleteId)).toEqual([BILAL]);
  });

  it('is a request the contract accepts', () => {
    const draft = [AMAL, BILAL].reduce<AttendanceDraft>(
      (current, athleteId) => markAthlete(current, athleteId, { status: 'excused' }),
      {},
    );
    const request = toAttendanceRequest(buildRegister(ROSTER.slice(0, 2), [], draft).pending);
    expect(RecordAttendanceRequest.safeParse(request).success).toBe(true);
  });
});

describe('after a submission', () => {
  it('drops from the draft the athletes the API now holds, and keeps the others', () => {
    const draft = draftOf({ [AMAL]: { status: 'present' }, [BILAL]: { status: 'late' } });
    expect(Object.keys(withoutRecorded(draft, [entry(AMAL, 'present')]))).toEqual([BILAL]);
  });

  it('adds what the API answered to the register on screen, once each', () => {
    const before = [entry(AMAL, 'present')];
    const merged = mergeEntries(before, [entry(AMAL, 'present'), entry(BILAL, 'late')]);
    expect(merged.map((item) => item.athleteId)).toEqual([AMAL, BILAL]);
    expect(mergeEntries(undefined, [entry(CARA, 'absent')])).toHaveLength(1);
  });
});
