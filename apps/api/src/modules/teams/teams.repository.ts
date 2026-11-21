import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { athletes, teamMemberships, teams } from '../../db/schema';
import { requestContext } from '../../common/tenancy/request-context';

export type TeamRow = typeof teams.$inferSelect;
export type MembershipRow = typeof teamMemberships.$inferSelect;

@Injectable()
export class TeamsRepository {
  private ctx() {
    return requestContext.require();
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

  async findTeam(id: string): Promise<TeamRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.academyId, academyId)))
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
        ),
      )
      .returning();
    return row;
  }

  /**
   * The roster AS IT WAS at an instant -- the query that makes historical reporting
   * truthful. Note it is a point-in-time containment test against the membership
   * period, never a read of some "current team" column.
   */
  async rosterAt(teamId: string, at: Date): Promise<{ athleteId: string; fullName: string }[]> {
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
        ),
      );
    return rows.map((r) => ({
      athleteId: r.athleteId,
      fullName: `${r.firstName} ${r.lastName}`,
    }));
  }

  /** Was this athlete a member of this team at that instant? Used when recording attendance. */
  async wasMemberAt(teamId: string, athleteId: string, at: Date): Promise<boolean> {
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
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
