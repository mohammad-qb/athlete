import { Injectable } from '@nestjs/common';
import { and, count, eq, gte, lt, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Action, SessionListQuery } from '@athlete/contracts';
import { sessionParticipants, trainingSessions } from '../../db/schema';
import type { SubjectRows } from '../../common/authz/ability';
import { accessibleBy } from '../../common/authz/accessible-by';
import { isActive } from '../../common/db/active-row';
import { orderBy, pageWindow } from '../../common/db/listing';
import { requestContext } from '../../common/tenancy/request-context';

export type SessionRow = typeof trainingSessions.$inferSelect;
export type ParticipantRow = typeof sessionParticipants.$inferSelect;

/** The columns the policy may condition on, per subject this repository owns. */
const COLUMNS = {
  trainingSessions: { teamId: trainingSessions.teamId },
  sessionParticipants: { teamIdAtTime: sessionParticipants.teamIdAtTime },
} satisfies {
  [S in 'trainingSessions' | 'sessionParticipants']: Record<keyof SubjectRows[S], AnyColumn>;
};

/** What `?sort=` may name, and the column each name orders by. */
const SESSION_SORT_COLUMNS = { startsAt: trainingSessions.startsAt } satisfies Record<
  string,
  AnyColumn
>;

/**
 * Reads take a REQUIRED `access` predicate, as in `AthletesRepository`: the principal's
 * scope for the action, from `accessFilter`. `undefined` means unrestricted and only
 * `accessFilter` produces it.
 */
@Injectable()
export class SessionsRepository {
  private ctx() {
    return requestContext.require();
  }

  /** Which rows of `subject` may the current principal `action`? Throws FORBIDDEN if none. */
  accessFilter(action: Action, subject: keyof typeof COLUMNS): SQL | undefined {
    return accessibleBy(this.ctx().ability, action, subject, COLUMNS[subject]);
  }

  async createSession(input: {
    teamId: string;
    startsAt: Date;
    endsAt: Date;
    location: string | null;
  }): Promise<SessionRow> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .insert(trainingSessions)
      .values({ ...input, academyId })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * One page of sessions and the size of the result it is a page of.
   *
   * `teamId`, `from` and `to` narrow the result; `access` bounds it. They are AND-ed, so
   * a coach who names a team they do not coach gets an empty page counted as zero, the
   * same answer as for a team with no sessions. `from`/`to` are the half-open interval
   * [from, to) over `starts_at`.
   */
  async pageOfSessions(
    query: SessionListQuery,
    access: SQL | undefined,
  ): Promise<{ rows: SessionRow[]; total: number }> {
    const { tx, academyId } = this.ctx();
    const where = and(
      eq(trainingSessions.academyId, academyId),
      access,
      query.teamId ? eq(trainingSessions.teamId, query.teamId) : undefined,
      query.from ? gte(trainingSessions.startsAt, new Date(query.from)) : undefined,
      query.to ? lt(trainingSessions.startsAt, new Date(query.to)) : undefined,
    );
    const { limit, offset } = pageWindow(query);

    const rows = await tx
      .select()
      .from(trainingSessions)
      .where(where)
      .orderBy(...orderBy(SESSION_SORT_COLUMNS, query.sort, trainingSessions.id))
      .limit(limit)
      .offset(offset);
    const [counted] = await tx.select({ total: count() }).from(trainingSessions).where(where);

    return { rows, total: counted?.total ?? 0 };
  }

  async findSession(id: string, access: SQL | undefined): Promise<SessionRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.id, id), eq(trainingSessions.academyId, academyId), access))
      .limit(1);
    return row;
  }

  /**
   * Idempotent insert. `on conflict (academy_id, client_record_id) do nothing` means a
   * retried or late-syncing offline submission is a no-op rather than a duplicate
   * register entry -- the property that lets a future offline mobile client ship
   * without redesigning this endpoint.
   */
  async recordParticipation(
    entries: {
      sessionId: string;
      athleteId: string;
      teamIdAtTime: string;
      status: string;
      note: string | null;
      clientRecordId: string;
      recordedByUserId: string;
    }[],
  ): Promise<ParticipantRow[]> {
    const { tx, academyId } = this.ctx();
    if (entries.length === 0) return [];
    return tx
      .insert(sessionParticipants)
      .values(entries.map((entry) => ({ ...entry, academyId })))
      .onConflictDoNothing({
        target: [sessionParticipants.academyId, sessionParticipants.clientRecordId],
      })
      .returning();
  }

  /**
   * The register for a session, read back as the facts that were recorded -- not
   * reconstructed from today's membership. This is why a transfer cannot rewrite it.
   * Voided entries stay in the table and out of the register.
   */
  async participantsFor(sessionId: string, access: SQL | undefined): Promise<ParticipantRow[]> {
    const { tx, academyId } = this.ctx();
    return tx
      .select()
      .from(sessionParticipants)
      .where(
        and(
          eq(sessionParticipants.sessionId, sessionId),
          eq(sessionParticipants.academyId, academyId),
          isActive(sessionParticipants),
          access,
        ),
      );
  }
}
