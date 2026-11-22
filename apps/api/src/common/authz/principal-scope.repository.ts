import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { teamCoachAssignments, teamMemberships } from '../../db/schema';
import type { RequestContext } from '../tenancy/request-context';
import type { Principal, PrincipalScope } from './principal';

/** The tenant-scoped transaction, as the request context types it. */
type TenantTx = RequestContext['tx'];

/**
 * Resolves a principal's scope: the two reads the whole authorization model rests on.
 *
 * It takes the transaction as a parameter, unlike feature repositories, because it
 * runs while the request context is still being assembled -- the scope it returns is
 * part of that context. `TenantTx` only ever comes from `runInTenantTransaction`, so
 * the tenant key is already applied and RLS confines both queries.
 *
 * It lives in the common layer, not in the teams module, for the reason the old
 * PolicyService did: authorization reads routed through feature repositories would
 * make the common layer depend on feature modules.
 *
 * `asOf` is the caller's to supply, and request code supplies the DATABASE's clock --
 * the `startedAt` that `runInTenantTransaction` reads from the transaction's `now()`,
 * the same clock `PolicyService` and the periods themselves are written against. It is
 * a parameter, not read here, so the instant is taken once per request and so a test
 * can ask about a chosen one.
 */
@Injectable()
export class PrincipalScopeRepository {
  async resolve(tx: TenantTx, principal: Principal, asOf: Date): Promise<PrincipalScope> {
    // Only a coach's grants are conditional on these sets. Administrators are scoped by
    // RLS alone, so their requests pay for no extra query.
    if (!principal.roles.includes('coach')) {
      return { asOf, activeTeamIds: [], visibleAthleteIds: [] };
    }

    const assignments = await tx
      .selectDistinct({ teamId: teamCoachAssignments.teamId })
      .from(teamCoachAssignments)
      .where(
        and(
          eq(teamCoachAssignments.academyId, principal.academyId),
          eq(teamCoachAssignments.coachUserId, principal.userId),
          // Half-open period [valid_from, valid_to): an assignment that closed at
          // exactly `asOf` is already over.
          lte(teamCoachAssignments.validFrom, asOf),
          or(isNull(teamCoachAssignments.validTo), gt(teamCoachAssignments.validTo, asOf)),
        ),
      );
    const activeTeamIds = assignments.map((row) => row.teamId);

    if (activeTeamIds.length === 0) {
      return { asOf, activeTeamIds, visibleAthleteIds: [] };
    }

    const memberships = await tx
      .selectDistinct({ athleteId: teamMemberships.athleteId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.academyId, principal.academyId),
          inArray(teamMemberships.teamId, activeTeamIds),
          lte(teamMemberships.validFrom, asOf),
          or(isNull(teamMemberships.validTo), gt(teamMemberships.validTo, asOf)),
        ),
      );

    return { asOf, activeTeamIds, visibleAthleteIds: memberships.map((row) => row.athleteId) };
  }
}
