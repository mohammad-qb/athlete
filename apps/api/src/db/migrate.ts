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

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error(error.message);
      process.exit(1);
    });
}
