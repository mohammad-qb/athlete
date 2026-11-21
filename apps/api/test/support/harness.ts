import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Connected as the APPLICATION role, so RLS actually applies. See note below. */
  pool: Pool;
  /** Superuser connection, used only to provision the app role. Never used in assertions. */
  adminPool: Pool;
  url: string;
  stop: () => Promise<void>;
}

const APP_ROLE = 'athlete_app';
const APP_ROLE_PASSWORD = 'app-role-test-password';

/**
 * Real Postgres, real migrations. These guarantees live in the database -- RLS
 * policies, exclusion constraints, composite foreign keys -- so testing them against
 * a mock or an in-memory substitute would prove nothing at all.
 *
 * IMPORTANT, and the single easiest way to ship an RLS design that does nothing:
 *
 *   A SUPERUSER (and any role with BYPASSRLS) ignores row-level security entirely.
 *   ALTER TABLE ... FORCE ROW LEVEL SECURITY subjects the table OWNER to its policies,
 *   but it does NOT constrain a superuser. The first version of these tests connected
 *   as the container's default superuser and "passed" while reading across tenants.
 *
 *   So the tests connect as `athlete_app` -- the same non-owner, NOBYPASSRLS role the
 *   application uses in production. If that distinction is ignored, the suite becomes
 *   decorative: green locally, leaking in production.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const adminUrl = container.getConnectionUri();
  await runMigrations(adminUrl);

  const adminPool = new Pool({ connectionString: adminUrl, max: 2 });

  // The migration creates athlete_app as NOLOGIN, because production authenticates it
  // with a credential from Key Vault rather than one committed to a repository. Tests
  // grant it a local password so they can connect AS the application role.
  await adminPool.query(
    `alter role ${APP_ROLE} with login password '${APP_ROLE_PASSWORD}'`,
  );

  const url = `postgres://${APP_ROLE}:${APP_ROLE_PASSWORD}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const pool = new Pool({ connectionString: url, max: 5 });

  return {
    container,
    pool,
    adminPool,
    url,
    stop: async () => {
      await pool.end();
      await adminPool.end();
      await container.stop();
    },
  };
}

/**
 * Runs a callback inside a transaction with the tenant key applied -- the same
 * mechanism the API uses. Note that even the table owner is subject to the policies
 * here, because the migration sets FORCE ROW LEVEL SECURITY. Without that, these tests
 * would pass while production leaked.
 */
export async function asAcademy<T>(
  pool: Pool,
  academyId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.current_academy_id', $1, true)`, [academyId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** Same, but leaves the transaction open so a conflicting concurrent write can be staged. */
export async function beginAsAcademy(pool: Pool, academyId: string) {
  const client = await pool.connect();
  await client.query('begin');
  await client.query(`select set_config('app.current_academy_id', $1, true)`, [academyId]);
  return {
    client,
    commit: async () => {
      await client.query('commit');
      client.release();
    },
    rollback: async () => {
      await client.query('rollback');
      client.release();
    },
  };
}

export interface SeededAcademy {
  academyId: string;
  adminUserId: string;
  coachUserId: string;
}

export async function seedAcademy(pool: Pool, name: string): Promise<SeededAcademy> {
  const academyId = randomUUID();

  // `users` is intentionally not tenant-scoped (one person may work at several
  // academies), so it needs no tenant context.
  const admin = await pool.query(
    `insert into users (email, password_hash, full_name) values ($1, 'x', $2) returning id`,
    [`admin+${academyId}@example.test`, `${name} Admin`],
  );
  const coach = await pool.query(
    `insert into users (email, password_hash, full_name) values ($1, 'x', $2) returning id`,
    [`coach+${academyId}@example.test`, `${name} Coach`],
  );
  const adminUserId = admin.rows[0].id as string;
  const coachUserId = coach.rows[0].id as string;

  await asAcademy(pool, academyId, async (client) => {
    await client.query(`insert into academies (id, name) values ($1, $2)`, [academyId, name]);
    await client.query(
      `insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, 'academy_admin'), ($1, $3, 'coach')`,
      [academyId, adminUserId, coachUserId],
    );
  });

  return { academyId, adminUserId, coachUserId };
}

export async function createTeam(
  pool: Pool,
  academyId: string,
  name: string,
  sport = 'football',
  ageGroup: string | null = null,
): Promise<string> {
  return asAcademy(pool, academyId, async (client) => {
    const { rows } = await client.query(
      `insert into teams (academy_id, name, sport, age_group) values ($1, $2, $3, $4) returning id`,
      [academyId, name, sport, ageGroup],
    );
    return rows[0].id as string;
  });
}

export async function createAthlete(
  pool: Pool,
  academyId: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  return asAcademy(pool, academyId, async (client) => {
    const { rows } = await client.query(
      `insert into athletes (academy_id, first_name, last_name, date_of_birth)
       values ($1, $2, $3, '2008-01-01') returning id`,
      [academyId, firstName, lastName],
    );
    return rows[0].id as string;
  });
}

export async function addMembership(
  pool: Pool,
  academyId: string,
  teamId: string,
  athleteId: string,
  validFrom: string,
  validTo: string | null = null,
): Promise<string> {
  return asAcademy(pool, academyId, async (client) => {
    const { rows } = await client.query(
      `insert into team_memberships (academy_id, team_id, athlete_id, valid_from, valid_to)
       values ($1, $2, $3, $4, $5) returning id`,
      [academyId, teamId, athleteId, validFrom, validTo],
    );
    return rows[0].id as string;
  });
}

export async function assignCoach(
  pool: Pool,
  academyId: string,
  teamId: string,
  coachUserId: string,
  validFrom: string,
  validTo: string | null = null,
): Promise<void> {
  await asAcademy(pool, academyId, async (client) => {
    await client.query(
      `insert into team_coach_assignments (academy_id, team_id, coach_user_id, valid_from, valid_to)
       values ($1, $2, $3, $4, $5)`,
      [academyId, teamId, coachUserId, validFrom, validTo],
    );
  });
}
