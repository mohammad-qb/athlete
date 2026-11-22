import { Injectable } from '@nestjs/common';
import { and, eq, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Action } from '@athlete/contracts';
import { sessionParticipants, trainingSessions } from '../../db/schema';
import type { SubjectRows } from '../../common/authz/ability';
import { accessibleBy } from '../../common/authz/accessible-by';
import { isActive } from '../../common/db/active-row';
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
