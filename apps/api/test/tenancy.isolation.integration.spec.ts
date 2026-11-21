import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAcademy,
  createAthlete,
  createTeam,
  seedAcademy,
  startTestDatabase,
  type TestDatabase,
} from './support/harness';

/**
 * PROVES: an academy cannot read, reference, or write across the tenant boundary.
 *
 * Answers the brief's "prevent unauthorized access between academies". The point of
 * testing it at the database level is that the guarantee then holds for every query in
 * the system -- including ones written next year by someone who has not read this file.
 */
describe('tenant isolation', () => {
  let db: TestDatabase;
  let academyA: Awaited<ReturnType<typeof seedAcademy>>;
  let academyB: Awaited<ReturnType<typeof seedAcademy>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    academyA = await seedAcademy(db.pool, 'Dubai Falcons Academy');
    academyB = await seedAcademy(db.pool, 'Abu Dhabi Oryx Academy');
    await createAthlete(db.pool, academyA.academyId, 'Amal', 'Falcon');
    await createAthlete(db.pool, academyB.academyId, 'Badr', 'Oryx');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('connects as a role that CANNOT bypass RLS', async () => {
    // The guard that makes every other assertion in this file meaningful. A superuser
    // or a BYPASSRLS role ignores policies entirely, so an RLS test suite running as
    // one is green and worthless. This asserts the premise instead of assuming it.
    const { rows } = await db.pool.query(
      `select current_user as role, rolsuper, rolbypassrls
         from pg_roles where rolname = current_user`,
    );
    expect(rows[0].role).toBe('athlete_app');
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it('shows an academy only its own athletes', async () => {
    const seenByA = await asAcademy(db.pool, academyA.academyId, async (client) => {
      const { rows } = await client.query('select first_name from athletes');
      return rows.map((r) => r.first_name as string);
    });

    expect(seenByA).toEqual(['Amal']);
    expect(seenByA).not.toContain('Badr');
  });

  it('returns ZERO rows when no tenant context is set (fails closed, not open)', async () => {
    // The dangerous failure mode would be returning everything. A forgotten tenant
    // context must be an empty result, never a cross-tenant dump.
    const client = await db.pool.connect();
    try {
      const { rows } = await client.query('select id from athletes');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('refuses to INSERT a row belonging to another academy', async () => {
    // RLS WITH CHECK, not just USING: isolation covers writes as well as reads.
    await expect(
      asAcademy(db.pool, academyA.academyId, (client) =>
        client.query(
          `insert into athletes (academy_id, first_name, last_name, date_of_birth)
           values ($1, 'Smuggled', 'Row', '2009-01-01')`,
          [academyB.academyId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses to REFERENCE another academy\'s team (composite foreign key)', async () => {
    // RLS alone would not catch this: academy A inserting a membership that points at
    // academy B's team passes a plain FK check. The composite key (academy_id, team_id)
    // makes the reference impossible, so tenant integrity covers writes too.
    const teamInB = await createTeam(db.pool, academyB.academyId, 'B First Team');
    const athleteInA = await createAthlete(db.pool, academyA.academyId, 'Cross', 'Tenant');

    await expect(
      asAcademy(db.pool, academyA.academyId, (client) =>
        client.query(
          `insert into team_memberships (academy_id, team_id, athlete_id, valid_from)
           values ($1, $2, $3, now())`,
          [academyA.academyId, teamInB, athleteInA],
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it('exposes cross-academy role assignments only through the audited function', async () => {
    // A person may work at several academies. Login needs that list before any tenant
    // context exists, so exactly one SECURITY DEFINER function provides it -- returning
    // role assignments only, never domain data.
    const sharedUser = await db.pool.query(
      `insert into users (email, password_hash, full_name)
       values ($1, 'x', 'Shared Coach') returning id`,
      [`shared+${randomUUID()}@example.test`],
    );
    const userId = sharedUser.rows[0].id as string;

    for (const academy of [academyA, academyB]) {
      await asAcademy(db.pool, academy.academyId, (client) =>
        client.query(
          `insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, 'coach')`,
          [academy.academyId, userId],
        ),
      );
    }

    const { rows } = await db.pool.query('select * from app_academies_for_user($1)', [userId]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.role)).toEqual(['coach', 'coach']);
  });
});
