import { z } from 'zod';
import { IsoDateTime, Uuid, Versioned } from './primitives';

export const CreateTeamRequest = z.object({
  name: z.string().min(1).max(120),
  sport: z.string().min(1).max(60),
  ageGroup: z.string().min(1).max(30).nullable().default(null),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequest>;

export const TeamResponse = z
  .object({
    id: Uuid,
    academyId: Uuid,
    name: z.string(),
    sport: z.string(),
    ageGroup: z.string().nullable(),
  })
  .merge(Versioned);
export type TeamResponse = z.infer<typeof TeamResponse>;

/**
 * Membership is a PERIOD, never a mutable column on the athlete. Transferring an athlete
 * closes one period and opens another; nothing is overwritten, so history stays truthful.
 */
export const CreateMembershipRequest = z.object({
  athleteId: Uuid,
  validFrom: IsoDateTime,
  validTo: IsoDateTime.nullable().default(null),
});
export type CreateMembershipRequest = z.infer<typeof CreateMembershipRequest>;

export const TransferAthleteRequest = z.object({
  athleteId: Uuid,
  fromTeamId: Uuid,
  toTeamId: Uuid,
  effectiveAt: IsoDateTime,
});
export type TransferAthleteRequest = z.infer<typeof TransferAthleteRequest>;

export const MembershipResponse = z.object({
  id: Uuid,
  academyId: Uuid,
  teamId: Uuid,
  athleteId: Uuid,
  validFrom: IsoDateTime,
  validTo: IsoDateTime.nullable(),
});
export type MembershipResponse = z.infer<typeof MembershipResponse>;
