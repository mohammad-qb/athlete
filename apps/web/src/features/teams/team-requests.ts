import type {
  CreateMembershipRequest,
  CreateTeamRequest,
  TransferAthleteRequest,
} from '@athlete/contracts';
import type { PickerOption } from '@/components/pickers';
import { startOfDay, startOfNextDay } from '@/lib/dates';

/**
 * Each form's values, and the request it sends. The functions here are the ONLY place
 * a form's values become a request body: the form validates what they return against
 * the request's contract schema, then sends exactly that.
 */

export interface TeamValues {
  name: string;
  sport: string;
  /** A text box; empty means the team has no age group. */
  ageGroup: string;
}

export function toTeamRequest(values: TeamValues): CreateTeamRequest {
  return {
    name: values.name.trim(),
    sport: values.sport.trim(),
    ageGroup: values.ageGroup.trim() || null,
  };
}

export interface MembershipValues {
  athlete: PickerOption | null;
  /** Date inputs: the first day of the membership, and (optionally) its last. */
  validFrom: string;
  validTo: string;
}

/**
 * A membership runs from the start of its first day to the end of its last, in the
 * zone of whoever is entering it. No last day means it is open-ended.
 *
 * The API's period excludes its end, so the end of the last day is sent as the start of
 * the day after it: the athlete is on the roster as of their last day, and a membership
 * that starts the next day touches this one without overlapping it.
 */
export function toMembershipRequest(values: MembershipValues): CreateMembershipRequest {
  return {
    athleteId: values.athlete?.id ?? '',
    validFrom: startOfDay(values.validFrom),
    validTo: values.validTo ? startOfNextDay(values.validTo) : null,
  };
}

/** What the request schema cannot say: the period must not end before it starts. */
export function membershipPeriodError(values: MembershipValues): string | undefined {
  return values.validFrom && values.validTo && values.validTo < values.validFrom
    ? 'The last day cannot be before the first day.'
    : undefined;
}

export interface TransferValues {
  toTeam: PickerOption | null;
  /** A date input: the day the athlete moves. */
  effectiveAt: string;
}

/** A transfer closes the membership of `fromTeamId` and opens one in the chosen team, at the same instant. */
export function toTransferRequest(
  values: TransferValues,
  move: { athleteId: string; fromTeamId: string },
): TransferAthleteRequest {
  return {
    athleteId: move.athleteId,
    fromTeamId: move.fromTeamId,
    toTeamId: values.toTeam?.id ?? '',
    effectiveAt: startOfDay(values.effectiveAt),
  };
}
