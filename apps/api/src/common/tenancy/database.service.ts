import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from '../../db/schema';

type DrizzleDb = NodePgDatabase<typeof schema>;

/** Derived from Drizzle itself so it survives version changes. */
export type TenantTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DrizzleDb;

  constructor(connectionString: string, maxConnections = 10) {
    this.pool = new Pool({ connectionString, max: maxConnections });
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * Opens a transaction and applies the tenant key to it before anything else runs.
   *
   * set_config(..., is_local = true) is used rather than literal `SET LOCAL` because
   * only set_config can take a bound parameter -- interpolating a tenant id into SQL
   * text would be an injection point in the one place we can least afford it.
   *
   * Being transaction-scoped, the setting dies with the transaction: it cannot leak
   * onto the next request that borrows the same pooled connection, and it behaves
   * correctly behind a transaction-mode pooler.
   *
   * A thrown error rolls the whole thing back, so a failed request writes nothing.
   *
   * The same statement reads the transaction's `now()` and hands it to the callback as
   * `startedAt`. Anything that must agree with the periods stored in the database --
   * which assignments are current, above all -- takes its instant from here rather than
   * from this process's clock: an API host that lags would keep an expired assignment
   * in scope, and one that leads would activate a future one early. Riding on the
   * set_config round-trip, it costs no extra query. Read as epoch milliseconds so the
   * value does not depend on how the driver parses `timestamptz`; a `Date` holds
   * milliseconds, so the microseconds are truncated.
   */
  async runInTenantTransaction<T>(
    academyId: string,
    fn: (tx: TenantTx, startedAt: Date) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ ms: number }>(
        sql`select set_config('app.current_academy_id', ${academyId}, true),
                   floor(extract(epoch from now()) * 1000)::float8 as ms`,
      );
      const ms = result.rows[0]?.ms;
      if (typeof ms !== 'number' || !Number.isFinite(ms)) {
        throw new Error('Could not read the transaction time from the database');
      }
      return fn(tx, new Date(ms));
    });
  }

  /**
   * Escape hatch for the login path only, which must look up a user before any academy
   * has been chosen. It runs WITHOUT a tenant key, so every RLS policy evaluates false
   * and no tenant-owned row is reachable; cross-tenant role lookup goes through the
   * audited app_academies_for_user() function instead.
   */
  async runUnscoped<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(tx));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
