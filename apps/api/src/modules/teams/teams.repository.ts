import { Injectable } from '@nestjs/common';
import { and, count, eq, ilike, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Action, TeamListQuery } from '@athlete/contracts';
import { athletes, teamMemberships, teams } from '../../db/schema';
import type { SubjectRows } from '../../common/authz/ability';
import { accessibleBy } from '../../common/authz/accessible-by';
import { isActive } from '../../common/db/active-row';
import { containsPattern, orderBy, pageWindow } from '../../common/db/listing';
import { requestContext } from '../../common/tenancy/request-context';

export type TeamRow = typeof teams.$inferSelect;
export type MembershipRow = typeof teamMemberships.$inferSelect;

/** The columns the policy may condition on, per subject this repository owns. */
const COLUMNS = {
  teams: { id: teams.id },
  teamMemberships: { teamId: teamMemberships.teamId },
} satisfies { [S in 'teams' | 'teamMemberships']: Record<keyof SubjectRows[S], AnyColumn> };

/** What `?sort=` may name, and the column each name orders by. */
const TEAM_SORT_COLUMNS = { name: teams.name } satisfies Record<string, AnyColumn>;

/**
 * Reads take a REQUIRED `access` predicate, as in `AthletesRepository`: the principal's
 * scope for the action, from `accessFilter`. `undefined` means unrestricted and only
 * `accessFilter` produces it.
 */
@Injectable()
export class TeamsRepository {
  private ctx() {
    return requestContext.require();
  }

  /** Which rows of `subject` may the current principal `action`? Throws FORBIDDEN if none. */
  accessFilter(action: Action, subject: keyof typeof COLUMNS): SQL | undefined {
    return accessibleBy(this.ctx().ability, action, subject, COLUMNS[subject]);
  }

  async createTeam(input: {
    name: string;
    sport: string;
    ageGroup: string | null;
  }): Promise<TeamRow> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .insert(teams)
      .values({ ...input, academyId })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * One page of teams and the size of the result it is a page of. `total` is counted
   * with the same predicate, access filter included: a coach's total is the number of
   * teams they coach, never the number the academy has.
   */
  async pageOfTeams(
    query: TeamListQuery,
    access: SQL | undefined,
  ): Promise<{ rows: TeamRow[]; total: number }> {
    const { tx, academyId } = this.ctx();
    const where = and(
      eq(teams.academyId, academyId),
      access,
      query.q ? ilike(teams.name, containsPattern(query.q)) : undefined,
    );
    const { limit, offset } = pageWindow(query);

    const rows = await tx
      .select()
      .from(teams)
      .where(where)
      .orderBy(...orderBy(TEAM_SORT_COLUMNS, query.sort, teams.id))
      .limit(limit)
      .offset(offset);
    const [counted] = await tx.select({ total: count() }).from(teams).where(where);

    return { rows, total: counted?.total ?? 0 };
  }

  async findTeam(id: string, access: SQL | undefined): Promise<TeamRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.academyId, academyId), access))
      .limit(1);
    return row;
  }

  async addMembership(input: {
    teamId: string;
    athleteId: string;
    validFrom: Date;
    validTo: Date | null;
  }): Promise<MembershipRow> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .insert(teamMemberships)
      .values({ ...input, academyId })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  /** Closes the open period rather than deleting it: the past remains on record. */
  async closeOpenMembership(
    teamId: string,
    athleteId: string,
    effectiveAt: Date,
  ): Promise<MembershipRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .update(teamMemberships)
      .set({ validTo: effectiveAt })
      .where(
        and(
          eq(teamMemberships.academyId, academyId),
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.athleteId, athleteId),
          isNull(teamMemberships.validTo),
          isActive(teamMemberships),
        ),
      )
      .returning();
    return row;
  }

  /**
   * The roster AS IT WAS at an instant -- the query that makes historical reporting
   * truthful. Note it is a point-in-time containment test against the membership
   * period, never a read of some "current team" column.
   *
   * `access` is the principal's scope over MEMBERSHIPS, and deliberately the only one
   * applied: the athletes join is not filtered by today's athlete scope, because a
   * historical roster legitimately names athletes who have since left the team.
   */
  async rosterAt(
    teamId: string,
    at: Date,
    access: SQL | undefined,
  ): Promise<{ athleteId: string; fullName: string }[]> {
    const { tx, academyId } = this.ctx();
    const rows = await tx
      .select({
        athleteId: athletes.id,
        firstName: athletes.firstName,
        lastName: athletes.lastName,
      })
      .from(teamMemberships)
      .innerJoin(
        athletes,
        and(
          eq(athletes.id, teamMemberships.athleteId),
          eq(athletes.academyId, teamMemberships.academyId),
        ),
      )
      .where(
        and(
          eq(teamMemberships.academyId, academyId),
          eq(teamMemberships.teamId, teamId),
          sql`${teamMemberships.validFrom} <= ${at}`,
          or(isNull(teamMemberships.validTo), sql`${teamMemberships.validTo} > ${at}`),
          isActive(teamMemberships),
          access,
        ),
      );
    return rows.map((r) => ({
      athleteId: r.athleteId,
      fullName: `${r.firstName} ${r.lastName}`,
    }));
  }

  /** Was this athlete a member of this team at that instant? Used when recording attendance. */
  async wasMemberAt(
    teamId: string,
    athleteId: string,
    at: Date,
    access: SQL | undefined,
  ): Promise<boolean> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select({ id: teamMemberships.id })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.academyId, academyId),
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.athleteId, athleteId),
          sql`${teamMemberships.validFrom} <= ${at}`,
          or(isNull(teamMemberships.validTo), sql`${teamMemberships.validTo} > ${at}`),
          isActive(teamMemberships),
          access,
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
