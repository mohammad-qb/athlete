import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAcademy,
  beginAsAcademy,
  createAthlete,
  seedAcademy,
  startTestDatabase,
  type TestDatabase,
} from './support/harness';

/**
 * PROVES: the second of two concurrent writers loses, loudly.
 *
 * Answers the brief's discussion scenario "two users update the same record
 * simultaneously". The failure mode being prevented is silent lost-update: both writes
 * succeed, the first one's change vanishes, and nobody is told.
 */
describe('optimistic concurrency', () => {
  let db: TestDatabase;
  let academy: Awaited<ReturnType<typeof seedAcademy>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    academy = await seedAcademy(db, 'Sharjah Sports Academy');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('rejects the stale writer: compare-and-set on version affects zero rows', async () => {
    const athleteId = await createAthlete(db.pool, academy.academyId, 'Layla', 'Hassan');

    // Both users load the same athlete: both hold version 0 (the ETag they were served).
    const loaded = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query('select version from athletes where id = $1', [
        athleteId,
      ]);
      return rows[0].version as number;
    });
    expect(loaded).toBe(0);

    // User 1 writes first and wins: version 0 -> 1.
    const first = await asAcademy(db.pool, academy.academyId, (client) =>
      client.query(
        `update athletes set last_name = 'Hassan-Ali', version = version + 1
         where id = $1 and version = $2`,
        [athleteId, loaded],
      ),
    );
    expect(first.rowCount).toBe(1);

    // User 2 submits the edit they started earlier, still carrying version 0.
    const second = await asAcademy(db.pool, academy.academyId, (client) =>
      client.query(
        `update athletes set last_name = 'Hassan-Omar', version = version + 1
         where id = $1 and version = $2`,
        [athleteId, loaded],
      ),
    );

    // Zero rows affected -> the API answers 409 Conflict instead of overwriting.
    expect(second.rowCount).toBe(0);

    const final = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        'select last_name, version from athletes where id = $1',
        [athleteId],
      );
      return rows[0] as { last_name: string; version: number };
    });

    // The first writer's change survived intact; nothing was silently lost.
    expect(final.last_name).toBe('Hassan-Ali');
    expect(final.version).toBe(1);
  });

  it('does not hold a row lock across user think-time', async () => {
    // Pessimistic locking was rejected deliberately: these are human-paced HTTP edits,
    // so SELECT ... FOR UPDATE would trade a rare recoverable 409 for routine
    // contention. This asserts a reader is never blocked by an in-flight writer.
    const athleteId = await createAthlete(db.pool, academy.academyId, 'Omar', 'Said');

    const writer = await beginAsAcademy(db.pool, academy.academyId);
    await writer.client.query(
      `update athletes set first_name = 'Omar-Updated', version = version + 1 where id = $1`,
      [athleteId],
    );

    // Reader proceeds immediately, seeing the pre-commit value (MVCC), not a timeout.
    const readDuringWrite = await asAcademy(db.pool, academy.academyId, async (client) => {
      await client.query(`set local statement_timeout = '2s'`);
      const { rows } = await client.query('select first_name from athletes where id = $1', [
        athleteId,
      ]);
      return rows[0].first_name as string;
    });
    expect(readDuringWrite).toBe('Omar');

    await writer.commit();
  });
});
