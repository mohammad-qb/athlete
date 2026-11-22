import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/cli/create-user';
import { DatabaseService } from '../src/common/tenancy/database.service';
import { runMigrations } from '../src/db/migrate';
import { PrincipalRepository } from '../src/modules/auth/principal.repository';
import { startTestDatabase, type TestDatabase } from './support/harness';

/**
 * PROVES: signing in works when the schema's owner is NOT a superuser -- which is the
 * production arrangement, and the one no other suite has.
 *
 * Every other integration test migrates as the container's superuser. A superuser
 * ignores row-level security, so anything that only works because the owner bypasses a
 * policy passes there and fails on a managed Postgres, where the administrator is an
 * ordinary role. Two things in the sign-in path depend on what the owner can see:
 *
 *   - `app_academies_for_user()` is SECURITY DEFINER, so it reads as the owner. Under
 *     FORCE ROW LEVEL SECURITY and no tenant key it returned nothing at all, until
 *     0003 gave the owner a SELECT policy on the two tables it reads.
 *   - the operator CLI runs as the owner and must set the tenant key to see an academy
 *     or insert a role grant.
 *
 * So this suite builds a second database owned by an ordinary role and runs the real
 * migrations, the real CLI and the real lookup against it.
 */
const OWNER = 'plain_owner';
const OWNER_PASSWORD = 'plain-owner-test-password';
const DATABASE = 'owned_by_a_plain_role';

describe('a schema whose owner is not a superuser', () => {
  let db: TestDatabase;
  let ownerPool: Pool;
  let appDatabase: DatabaseService;
  let principals: PrincipalRepository;

  const academy = (id: string, name: string) => async () => {
    const client = await ownerPool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.current_academy_id', $1, true)`, [id]);
      await client.query('insert into academies (id, name) values ($1, $2)', [id, name]);
      await client.query('commit');
    } finally {
      client.release();
    }
  };
  const ZEBRA = '10000000-0000-4000-8000-000000000001';
  const APEX = '20000000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    db = await startTestDatabase();

    // CREATEROLE because the migrations create the service roles; nothing more. This
    // is the shape of a managed-Postgres administrator: powerful, and bound by RLS.
    await db.adminPool.query(`create role ${OWNER} login password '${OWNER_PASSWORD}' createrole`);
    await db.adminPool.query(`create database ${DATABASE} owner ${OWNER}`);

    const at = (user: string, password: string) =>
      `postgres://${user}:${password}@${db.container.getHost()}:${db.container.getPort()}/${DATABASE}`;
    const ownerUrl = at(OWNER, OWNER_PASSWORD);

    await runMigrations(ownerUrl);

    ownerPool = new Pool({ connectionString: ownerUrl, max: 2 });
    // The service roles are cluster-wide and already have a login from the harness;
    // the migrations above granted them their privileges in THIS database.
    appDatabase = new DatabaseService(at('athlete_app', 'app-role-test-password'), 2);
    principals = new PrincipalRepository();

    await academy(ZEBRA, 'Zebra Academy')();
    await academy(APEX, 'Apex Academy')();
  }, 180_000);

  afterAll(async () => {
    await ownerPool?.end();
    await appDatabase?.onModuleDestroy();
    await db?.stop();
  });

  it('really is bound by row-level security: the fixture is not a superuser in disguise', async () => {
    const { rows } = await ownerPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

    // A tenant-owned table with no owner policy: without a tenant key the owner sees nothing.
    await ownerPool.query(
      `do $$ begin
         perform set_config('app.current_academy_id', '${ZEBRA}', true);
         insert into teams (academy_id, name, sport) values ('${ZEBRA}', 'Hidden', 'football');
       end $$`,
    );
    expect((await ownerPool.query('select 1 from teams')).rowCount).toBe(0);
  });

  it('the operator CLI creates an account and grants roles as that owner', async () => {
    const first = await createUser(ownerPool, {
      email: 'sam@example.test',
      name: 'Sam Example',
      academyId: ZEBRA,
      role: 'coach',
      password: 'a password for sam',
    });
    expect(first).toMatchObject({ created: true, roleGranted: true });

    const second = await createUser(ownerPool, {
      email: 'sam@example.test',
      name: 'Sam Example',
      academyId: APEX,
      role: 'academy_admin',
    });
    expect(second).toEqual({ userId: first.userId, created: false, roleGranted: true });
  });

  it('the cross-tenant lookup returns the user’s academies to the application role', async () => {
    const { rows } = await ownerPool.query<{ id: string }>(
      `select id from users where email = 'sam@example.test'`,
    );
    const userId = rows[0]?.id as string;

    // Empty here is the production failure: signed in, and a member of nothing.
    expect(await appDatabase.runUnscoped((tx) => principals.academiesFor(tx, userId))).toEqual([
      { id: APEX, name: 'Apex Academy', roles: ['academy_admin'] },
      { id: ZEBRA, name: 'Zebra Academy', roles: ['coach'] },
    ]);
  });

  it('the application role still sees neither table without a tenant key', async () => {
    // The owner's policy names the owner. It opens nothing to athlete_app.
    const direct = await appDatabase.runUnscoped(async (tx) => {
      const roles = await tx.execute('select 1 from user_academy_roles');
      const academies = await tx.execute('select 1 from academies');
      return { roles: roles.rowCount, academies: academies.rowCount };
    });
    expect(direct).toEqual({ roles: 0, academies: 0 });
  });

  it('the owner’s writes are still confined: no role grant without the tenant key', async () => {
    await expect(
      ownerPool.query(
        `insert into user_academy_roles (academy_id, user_id, role)
         select $1, id, 'coach' from users where email = 'sam@example.test'`,
        [APEX],
      ),
    ).rejects.toThrow(/row-level security policy/i);
  });
});
