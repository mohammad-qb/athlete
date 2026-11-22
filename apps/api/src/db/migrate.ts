import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');

/**
 * Forward-only migration runner.
 *
 * There are no down migrations by design. Every migration is additive and
 * backward-compatible with the API version currently deployed, so rolling back means
 * redeploying the previous image while the schema stays put. Destructive changes are
 * split across two releases (expand -> backfill -> ship -> contract later).
 *
 * This runs as its OWN CI job before the application deploy -- never on container
 * start, where two booting replicas would race each other.
 */
export async function runMigrations(
  connectionString: string,
  dir: string = MIGRATIONS_DIR,
): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create table if not exists _migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await client.query('select 1 from _migrations where name = $1', [file]);
      if (existing.rowCount && existing.rowCount > 0) continue;

      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into _migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

/** The roles the migrations create as NOLOGIN, and the only ones this will touch. */
export type ProvisionedRole = 'athlete_app' | 'athlete_auth';

/**
 * Lets one of the service roles log in with a password. LOCAL AND TEST USE ONLY.
 *
 * The migrations create `athlete_app` and `athlete_auth` as NOLOGIN on purpose: in
 * production their credentials are provisioned by infrastructure (Key Vault), never by
 * something committed to a repository. A compose stack and a test container have no
 * such infrastructure, and without this the only role that CAN log in is the superuser
 * -- which is exactly the connection the API refuses to start on.
 */
export async function provisionRoleLogin(
  connectionString: string,
  role: ProvisionedRole,
  password: string,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // ALTER ROLE takes no bound parameters, so both the identifier and the literal are
    // quoted by the server.
    const { rows } = await client.query<{ statement: string }>(
      `select format('alter role %I with login password %L', $1::text, $2::text) as statement`,
      [role, password],
    );
    const statement = rows[0]?.statement;
    if (!statement) throw new Error('Could not build the ALTER ROLE statement');
    await client.query(statement);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const appRolePassword = process.env.APP_ROLE_PASSWORD;
  const authRolePassword = process.env.AUTH_ROLE_PASSWORD;
  runMigrations(url)
    .then(async (applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
      if (appRolePassword) await provisionRoleLogin(url, 'athlete_app', appRolePassword);
      if (authRolePassword) await provisionRoleLogin(url, 'athlete_auth', authRolePassword);
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
