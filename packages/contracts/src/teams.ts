import { z } from 'zod';
import { IsoDateTime, listQueryOf, pageOf, strictObject, Uuid, Versioned } from './primitives';

export const CreateTeamRequest = strictObject({
  name: z.string().min(1).max(120),
  sport: z.string().min(1).max(60),
  ageGroup: z.string().min(1).max(30).nullable().default(null),
}).meta({ id: 'CreateTeamRequest' });
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

export const TeamResponse = z
  .object({
    id: Uuid,
    academyId: Uuid,
    name: z.string(),
    sport: z.string(),
    ageGroup: z.string().nullable(),
  })
  .merge(Versioned)
  .meta({ id: 'TeamResponse' });
export type TeamResponse = z.infer<typeof TeamResponse>;

/** `q` matches the team's name, case-insensitively. */
export const TeamListQuery = listQueryOf(['name'], 'name');
export type TeamListQuery = z.infer<typeof TeamListQuery>;

export const TeamPage = pageOf(TeamResponse).meta({ id: 'TeamPage' });
export type TeamPage = z.infer<typeof TeamPage>;

/**
 * Membership is a PERIOD, never a mutable column on the athlete. Transferring an athlete
 * closes one period and opens another; nothing is overwritten, so history stays truthful.
 */
export const CreateMembershipRequest = strictObject({
  athleteId: Uuid,
  validFrom: IsoDateTime,
  validTo: IsoDateTime.nullable().default(null),
}).meta({ id: 'CreateMembershipRequest' });
export type CreateMembershipRequest = z.infer<typeof CreateMembershipRequest>;

export const TransferAthleteRequest = strictObject({
  athleteId: Uuid,
  fromTeamId: Uuid,
  toTeamId: Uuid,
  effectiveAt: IsoDateTime,
}).meta({ id: 'TransferAthleteRequest' });
export type TransferAthleteRequest = z.infer<typeof TransferAthleteRequest>;

export const MembershipResponse = z
  .object({
    id: Uuid,
    academyId: Uuid,
    teamId: Uuid,
    athleteId: Uuid,
    validFrom: IsoDateTime,
    validTo: IsoDateTime.nullable(),
  })
  .meta({ id: 'MembershipResponse' });
export type MembershipResponse = z.infer<typeof MembershipResponse>;

/** A transfer is two facts: the period it closed and the one it opened. */
export const TransferResponse = z
  .object({ closed: MembershipResponse, opened: MembershipResponse })
  .meta({ id: 'TransferResponse' });
export type TransferResponse = z.infer<typeof TransferResponse>;

/**
 * `at` selects which period of the roster to show; absent means now. It must be a full
 * ISO-8601 instant with an offset -- a bare date would be read in whatever zone the
 * server happens to run in.
 */
export const RosterQuery = strictObject({ at: IsoDateTime.optional() });
export type RosterQuery = z.infer<typeof RosterQuery>;

/** One athlete on a roster at the instant asked about. */
export const RosterEntry = z
  .object({ athleteId: Uuid, fullName: z.string() })
  .meta({ id: 'RosterEntry' });
export type RosterEntry = z.infer<typeof RosterEntry>;

/** Not paginated: a roster is one team's athletes, tens of rows by construction. */
export const RosterResponse = z.array(RosterEntry);
export type RosterResponse = z.infer<typeof RosterResponse>;
