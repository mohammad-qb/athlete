import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { athletes } from '../../db/schema';
import { requestContext } from '../../common/tenancy/request-context';

export type AthleteRow = typeof athletes.$inferSelect;

/**
 * The only place in the athletes module where SQL exists.
 *
 * It takes no connection parameter: the transaction comes from the request context,
 * which already carries the tenant key. There is therefore no way to call this layer
 * "unscoped" -- an attempt outside a tenant transaction throws rather than querying.
 *
 * academy_id still appears in every predicate even though RLS already enforces it.
 * That redundancy is deliberate defence in depth: if a policy were ever dropped by a
 * bad migration, these queries keep working correctly instead of silently widening.
 */
@Injectable()
export class AthletesRepository {
  private ctx() {
    return requestContext.require();
  }

  async list(): Promise<AthleteRow[]> {
    const { tx, academyId } = this.ctx();
    return tx.select().from(athletes).where(eq(athletes.academyId, academyId));
  }

  async findById(id: string): Promise<AthleteRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, id), eq(athletes.academyId, academyId)))
      .limit(1);
    return row;
  }

  async insert(input: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  }): Promise<AthleteRow> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .insert(athletes)
      .values({ ...input, academyId })
      .returning();
    // RLS WITH CHECK would have rejected a foreign academy_id; a missing row here means
    // the insert was refused, which is a bug worth surfacing loudly rather than as undefined.
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * Compare-and-set on `version`. Returns undefined when nothing matched, which the
   * service distinguishes into 404 (gone) or 409 (stale) -- the caller deserves to know
   * which.
   */
  async updateIfVersionMatches(
    id: string,
    expectedVersion: number,
    patch: Partial<{ firstName: string; lastName: string; dateOfBirth: string }>,
  ): Promise<AthleteRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .update(athletes)
      .set({
        ...patch,
        version: sql`${athletes.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(athletes.id, id),
          eq(athletes.academyId, academyId),
          eq(athletes.version, expectedVersion),
        ),
      )
      .returning();
    return row;
  }
}
