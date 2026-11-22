import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { teamCoachAssignments, teamMemberships } from '../../db/schema';
import { requestContext } from '../tenancy/request-context';

/**
 * Resource-level authorization: the "responsibilities" half of
 * "roles and responsibilities".
 *
 * The subtle case this exists for, and the one worth defending out loud:
 *
 *   A coach who left a team in March must still be able to read the assessments THEY
 *   authored -- that is a historical record, and deleting their access would falsify
 *   it. But they must NOT see the team's roster today, because their assignment period
 *   has closed. Visibility therefore follows the temporal assignment, not a boolean
 *   flag on the user. History and authorization are the same model here.
 */
@Injectable()
export class PolicyService {
  /** Teams the principal coaches *right now*. Closed assignments are excluded. */
  private async activeCoachTeamIds(): Promise<string[]> {
    const { tx, userId } = requestContext.require();
    const rows = await tx
      .select({ teamId: teamCoachAssignments.teamId })
      .from(teamCoachAssignments)
      .where(
        and(
          eq(teamCoachAssignments.coachUserId, userId),
          sql`${teamCoachAssignments.validFrom} <= now()`,
          or(
            isNull(teamCoachAssignments.validTo),
            sql`${teamCoachAssignments.validTo} > now()`,
          ),
        ),
      );
    return rows.map((r) => r.teamId);
  }

  async assertCanAccessAthlete(athleteId: string): Promise<void> {
    const { roles } = requestContext.require();

    // Administrators are scoped by RLS to their own academy; within it they see all.
    if (roles.includes('academy_admin') || roles.includes('platform_admin')) return;

    if (roles.includes('coach')) {
      const teamIds = await this.activeCoachTeamIds();
      if (teamIds.length === 0) {
        throw new ForbiddenException('No active team assignment');
      }
      const { tx } = requestContext.require();
      const [match] = await tx
        .select({ id: teamMemberships.id })
        .from(teamMemberships)
        .where(
          and(
            eq(teamMemberships.athleteId, athleteId),
            inArray(teamMemberships.teamId, teamIds),
            sql`${teamMemberships.validFrom} <= now()`,
            or(isNull(teamMemberships.validTo), sql`${teamMemberships.validTo} > now()`),
          ),
        )
        .limit(1);
      if (!match) {
        throw new ForbiddenException('Athlete is not on a team you currently coach');
      }
      return;
    }

    // An athlete may read only their own record. The athlete<->user link is modelled
    // in the full design; in this slice it is intentionally denied rather than guessed.
    throw new ForbiddenException(`Role(s) ${roles.join(', ')} cannot access athlete ${athleteId}`);
  }

  async assertCanRecordAttendanceForTeam(teamId: string): Promise<void> {
    const { roles } = requestContext.require();
    if (roles.includes('academy_admin') || roles.includes('platform_admin')) return;
    if (roles.includes('coach')) {
      const teamIds = await this.activeCoachTeamIds();
      if (!teamIds.includes(teamId)) {
        throw new ForbiddenException('You do not currently coach this team');
      }
      return;
    }
    throw new ForbiddenException('Not permitted to record attendance');
  }
}
