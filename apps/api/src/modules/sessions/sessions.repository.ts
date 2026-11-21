import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { sessionParticipants, trainingSessions } from '../../db/schema';
import { requestContext } from '../../common/tenancy/request-context';

export type SessionRow = typeof trainingSessions.$inferSelect;
export type ParticipantRow = typeof sessionParticipants.$inferSelect;

@Injectable()
export class SessionsRepository {
  private ctx() {
    return requestContext.require();
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

  async findSession(id: string): Promise<SessionRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(trainingSessions)
      .where(and(eq(trainingSessions.id, id), eq(trainingSessions.academyId, academyId)))
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
   */
  async participantsFor(sessionId: string): Promise<ParticipantRow[]> {
    const { tx, academyId } = this.ctx();
    return tx
      .select()
      .from(sessionParticipants)
      .where(
        and(
          eq(sessionParticipants.sessionId, sessionId),
          eq(sessionParticipants.academyId, academyId),
        ),
      );
  }
}
