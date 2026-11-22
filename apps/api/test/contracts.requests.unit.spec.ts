import {
  CreateAthleteRequest,
  CreateMembershipRequest,
  CreateSessionRequest,
  CreateTeamRequest,
  IdParams,
  RecordAttendanceRequest,
  RosterQuery,
  TransferAthleteRequest,
  UpdateAthleteRequest,
} from '@athlete/contracts';
import { describe, expect, it } from 'vitest';

/**
 * PROVES: a request schema never turns a mistake into a successful no-op.
 *
 * `PATCH /athletes/:id` with `{"dateofBirth": "2010-01-01"}` used to validate to `{}`:
 * the unknown key was stripped, the update ran with nothing to change, the version was
 * bumped, and the caller got a 200 while every other client's ETag went stale.
 */
describe('request schemas', () => {
  const ID = '11111111-1111-4111-8111-111111111111';

  it('PATCH refuses a misspelled field instead of stripping it', () => {
    const result = UpdateAthleteRequest.safeParse({ dateofBirth: '2010-01-01' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.code)).toContain('unrecognized_keys');
  });

  it('PATCH refuses a body with no field at all', () => {
    expect(UpdateAthleteRequest.safeParse({}).success).toBe(false);
  });

  it('PATCH accepts any one recognised field', () => {
    expect(UpdateAthleteRequest.parse({ lastName: 'Falcon' })).toEqual({ lastName: 'Falcon' });
    expect(UpdateAthleteRequest.safeParse({ dateOfBirth: '2010-01-01' }).success).toBe(true);
  });

  it('PATCH still validates the fields it is given', () => {
    expect(UpdateAthleteRequest.safeParse({ dateOfBirth: 'nope' }).success).toBe(false);
  });

  it.each([
    ['CreateAthleteRequest', CreateAthleteRequest],
    ['UpdateAthleteRequest', UpdateAthleteRequest],
    ['CreateTeamRequest', CreateTeamRequest],
    ['CreateMembershipRequest', CreateMembershipRequest],
    ['TransferAthleteRequest', TransferAthleteRequest],
    ['CreateSessionRequest', CreateSessionRequest],
    ['RecordAttendanceRequest', RecordAttendanceRequest],
    ['IdParams', IdParams],
    ['RosterQuery', RosterQuery],
  ])('%s refuses an unknown key', (_name, schema) => {
    const result = schema.safeParse({ __not_a_field__: 1 });
    expect(result.error?.issues.map((issue) => issue.code)).toContain('unrecognized_keys');
  });

  it('strictness reaches nested objects: an attendance entry refuses an unknown key', () => {
    const result = RecordAttendanceRequest.safeParse({
      entries: [{ clientRecordId: ID, athleteId: ID, status: 'present', staus: 'late' }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['entries', 0] });
  });

  /**
   * `?at=garbage` used to become `new Date('garbage')`, reach the driver as an Invalid
   * Date and come back as a 500: a client error reported as a server fault.
   */
  describe('RosterQuery', () => {
    it('refuses a value that is not an instant', () => {
      expect(RosterQuery.safeParse({ at: 'garbage' }).success).toBe(false);
    });

    it('refuses a bare date, which has no zone', () => {
      expect(RosterQuery.safeParse({ at: '2026-01-01' }).success).toBe(false);
    });

    it('accepts an ISO-8601 instant, and its absence', () => {
      expect(RosterQuery.parse({ at: '2026-01-01T00:00:00Z' })).toEqual({ at: '2026-01-01T00:00:00Z' });
      expect(RosterQuery.parse({})).toEqual({});
    });
  });
});
