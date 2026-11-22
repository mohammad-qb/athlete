import type { Role } from '@athlete/contracts';

/**
 * Who is signed in, as resolved from the session cookie -- and nothing about what they
 * may do. A person with an account and no role in any academy is still an identity.
 */
export interface Identity {
  userId: string;
  email: string;
  name: string;
  /** The session row this request arrived on; the handle for switching academy. */
  sessionId: string;
}

/** One academy the user belongs to, with every role they hold there. */
export interface AcademyMembership {
  id: string;
  name: string;
  roles: Role[];
}

/**
 * Who is calling AND in which academy: the identity acting in its active academy, with
 * the roles held there. This is what the policy is evaluated for. The roles are read
 * from the database on every request; they are never stored in the session.
 */
export interface Principal {
  userId: string;
  academyId: string;
  roles: Role[];
}

/** What `AuthenticationGuard` leaves on the request for everything after it. */
export interface AuthenticatedRequest {
  /** Present when the cookie resolved to a live session. */
  identity?: Identity;
  /** Every academy the identity belongs to. Present whenever `identity` is. */
  memberships?: AcademyMembership[];
  /** Present when the identity holds a role in at least one academy. */
  principal?: Principal;
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
