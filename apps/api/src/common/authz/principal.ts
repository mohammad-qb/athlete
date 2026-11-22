import type { Role } from '@athlete/contracts';

/** Who is calling, as verified from the session token. Nothing here needs the database. */
export interface Principal {
  userId: string;
  academyId: string;
  roles: Role[];
}

/**
 * The "responsibilities" half of a principal: which teams and athletes they answer for
 * at `asOf`. Resolved ONCE per request, inside the tenant transaction, and then read by
 * every rule as a flat id list.
 *
 * Why id sets rather than a condition that walks assignment -> team -> membership:
 * a nested condition can be compiled to SQL but CASL's in-memory matcher cannot follow
 * it, so `can()` on a loaded row would deny what the query path allows. Keeping
 * conditions flat keeps the two directions in agreement, at the cost of one extra
 * query and an IN list of tens of ids at this scale.
 */
export interface PrincipalScope {
  /** The instant the sets below were resolved for. One value per request. */
  asOf: Date;
  /** Teams the principal coaches at `asOf`. A closed assignment contributes nothing. */
  activeTeamIds: string[];
  /** Athletes with a membership, current at `asOf`, in one of those teams. */
  visibleAthleteIds: string[];
}
