import { Injectable } from '@nestjs/common';
import { and, count, eq, ilike, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Action, AthleteListQuery } from '@athlete/contracts';
import { athletes } from '../../db/schema';
import type { SubjectRows } from '../../common/authz/ability';
import { accessibleBy } from '../../common/authz/accessible-by';
import { containsPattern, orderBy, pageWindow } from '../../common/db/listing';
import { requestContext } from '../../common/tenancy/request-context';

export type AthleteRow = typeof athletes.$inferSelect;

/**
 * The columns the policy may condition on for `athletes`. `satisfies` ties it to
 * `SubjectRows`: a rule on a new field does not compile until its column is mapped here.
 */
const ATHLETE_COLUMNS = { id: athletes.id } satisfies Record<
  keyof SubjectRows['athletes'],
  AnyColumn
>;

/** What `?sort=` may name, and the column each name orders by. */
const SORT_COLUMNS = {
  lastName: athletes.lastName,
  firstName: athletes.firstName,
  dateOfBirth: athletes.dateOfBirth,
  createdAt: athletes.createdAt,
} satisfies Record<string, AnyColumn>;

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
 *
 * Every method that reads or changes an existing row also takes a REQUIRED `access`
 * predicate -- the principal's scope for the action, from `accessFilter`. Required, not
 * optional, so a query written without deciding whose rows it may touch does not
 * compile. `undefined` is a real value here, meaning "unrestricted" (an administrator);
 * it only ever comes out of `accessFilter`, which throws rather than return it for a
 * principal who holds no grant.
 */
@Injectable()
export class AthletesRepository {
  private ctx() {
    return requestContext.require();
  }

  /** Which athletes may the current principal `action`? Throws FORBIDDEN if none at all. */
  accessFilter(action: Action): SQL | undefined {
    return accessibleBy(this.ctx().ability, action, 'athletes', ATHLETE_COLUMNS);
  }

  /**
   * One page, and the size of the whole result it is a page of.
   *
   * Both queries are built from the SAME predicate, access filter included. A count
   * taken without it would tell a coach how many athletes the academy has -- a number
   * about rows they may not see -- so `total` is, by construction, the number of rows
   * this principal could page through.
   */
  async page(
    query: AthleteListQuery,
    access: SQL | undefined,
  ): Promise<{ rows: AthleteRow[]; total: number }> {
    const { tx, academyId } = this.ctx();
    const pattern = query.q ? containsPattern(query.q) : undefined;
    const where = and(
      eq(athletes.academyId, academyId),
      access,
      pattern ? or(ilike(athletes.firstName, pattern), ilike(athletes.lastName, pattern)) : undefined,
    );
    const { limit, offset } = pageWindow(query);

    const rows = await tx
      .select()
      .from(athletes)
      .where(where)
      .orderBy(...orderBy(SORT_COLUMNS, query.sort, athletes.id))
      .limit(limit)
      .offset(offset);
    const [counted] = await tx.select({ total: count() }).from(athletes).where(where);

    return { rows, total: counted?.total ?? 0 };
  }

  async findById(id: string, access: SQL | undefined): Promise<AthleteRow | undefined> {
    const { tx, academyId } = this.ctx();
    const [row] = await tx
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, id), eq(athletes.academyId, academyId), access))
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
   * service distinguishes into 404 (gone, or out of scope) or 409 (stale) -- the caller
   * deserves to know which.
   */
  async updateIfVersionMatches(
    id: string,
    expectedVersion: number,
    patch: Partial<{ firstName: string; lastName: string; dateOfBirth: string }>,
    access: SQL | undefined,
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
          access,
        ),
      )
      .returning();
    return row;
  }
}
