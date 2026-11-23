import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { provisionRoleLogin, runMigrations } from '../../src/db/migrate';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Connected as the APPLICATION role, so RLS actually applies. See note below. */
  pool: Pool;
  /**
   * Superuser connection. Used to provision what the application role is not allowed to
   * create -- users, academies, role grants -- and, in the privilege tests, to show what
   * the OWNER is still refused. Never the subject of an isolation assertion.
   */
  adminPool: Pool;
  /** Connection string for the application role. */
  url: string;
  /**
   * Connection string for `athlete_auth`, the role better-auth connects as: identity
   * and sessions, and nothing tenant-owned.
   */
  authUrl: string;
  /** Connection string for the superuser/owner: the one the API must refuse to start on. */
  adminUrl: string;
  stop: () => Promise<void>;
}

const APP_ROLE = 'athlete_app';
const APP_ROLE_PASSWORD = 'app-role-test-password';
const AUTH_ROLE = 'athlete_auth';
const AUTH_ROLE_PASSWORD = 'auth-role-test-password';

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
  await provisionRoleLogin(adminUrl, APP_ROLE, APP_ROLE_PASSWORD);
  await provisionRoleLogin(adminUrl, AUTH_ROLE, AUTH_ROLE_PASSWORD);

  const address = `${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  const url = `postgres://${APP_ROLE}:${APP_ROLE_PASSWORD}@${address}`;
  const authUrl = `postgres://${AUTH_ROLE}:${AUTH_ROLE_PASSWORD}@${address}`;
  const pool = new Pool({ connectionString: url, max: 5 });

  return {
    container,
    pool,
    adminPool,
    url,
    authUrl,
    adminUrl,
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

/**
 * Onboards an academy with an administrator and a coach.
 *
 * Runs as the superuser because the application role cannot do any of it: `athlete_app`
 * holds SELECT only on `academies` and `user_academy_roles`, and nothing on `users`
 * (0002_grants.sql). These users have no credential: a test that signs in creates its
 * own through the operator CLI's `createUser`.
 * Onboarding is a platform operation, and the fixture is honest about that.
 */
export async function seedAcademy(db: TestDatabase, name: string): Promise<SeededAcademy> {
  const academyId = randomUUID();
  const pool = db.adminPool;

  const admin = await pool.query(
    `insert into users (email, full_name) values ($1, $2) returning id`,
    [`admin+${academyId}@example.test`, `${name} Admin`],
  );
  const coach = await pool.query(
    `insert into users (email, full_name) values ($1, $2) returning id`,
    [`coach+${academyId}@example.test`, `${name} Coach`],
  );
  const adminUserId = admin.rows[0].id as string;
  const coachUserId = coach.rows[0].id as string;

  await pool.query(`insert into academies (id, name) values ($1, $2)`, [academyId, name]);
  await pool.query(
    `insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, 'academy_admin'), ($1, $3, 'coach')`,
    [academyId, adminUserId, coachUserId],
  );

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

const DAY_MS = 24 * 60 * 60 * 1000;
/** An ISO instant `days` before now. Fixtures are relative so they do not rot with the calendar. */
export const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

export interface TwoTeamAcademy extends SeededAcademy {
  /** The team `coachUserId` coaches today. */
  teamA: string;
  /** The team `coachUserId` coached until a week ago, and nobody coaches now. */
  teamB: string;
  athleteOnA: string;
  athleteOnB: string;
  /** A coach whose ONLY assignment (team B) closed a week ago. */
  lapsedCoachUserId: string;
}

/**
 * Two teams in one academy -- the smallest fixture in which "which rows?" has more than
 * one answer inside a tenant, which is what resource scoping is about and what the
 * tenant-isolation fixtures cannot show.
 *
 *   team A: athleteOnA.  `coachUserId` assigned 90 days ago, still open.
 *   team B: athleteOnB.  `coachUserId` AND `lapsedCoachUserId` assigned 90 days ago,
 *                        both closed 7 days ago.
 *
 * So the same coach has a current team and a former one, and the lapsed coach has
 * nothing current at all: the two cases a temporal assignment has to get right.
 */
export async function seedTwoTeamAcademy(db: TestDatabase, name: string): Promise<TwoTeamAcademy> {
  const academy = await seedAcademy(db, name);
  const { academyId, coachUserId } = academy;

  const lapsed = await db.adminPool.query(
    `insert into users (email, full_name) values ($1, $2) returning id`,
    [`lapsed+${academyId}@example.test`, `${name} Former Coach`],
  );
  const lapsedCoachUserId = lapsed.rows[0].id as string;
  await db.adminPool.query(
    `insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, 'coach')`,
    [academyId, lapsedCoachUserId],
  );

  const teamA = await createTeam(db.pool, academyId, 'Team A');
  const teamB = await createTeam(db.pool, academyId, 'Team B');
  const athleteOnA = await createAthlete(db.pool, academyId, 'Aisha', 'OnA');
  const athleteOnB = await createAthlete(db.pool, academyId, 'Bilal', 'OnB');

  await addMembership(db.pool, academyId, teamA, athleteOnA, daysAgo(90));
  await addMembership(db.pool, academyId, teamB, athleteOnB, daysAgo(90));

  await assignCoach(db.pool, academyId, teamA, coachUserId, daysAgo(90));
  await assignCoach(db.pool, academyId, teamB, coachUserId, daysAgo(90), daysAgo(7));
  await assignCoach(db.pool, academyId, teamB, lapsedCoachUserId, daysAgo(90), daysAgo(7));

  return { ...academy, teamA, teamB, athleteOnA, athleteOnB, lapsedCoachUserId };
}
