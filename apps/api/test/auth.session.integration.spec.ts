import type { ExecutionContext } from '@nestjs/common';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../src/cli/create-user';
import type { AuthenticatedRequest } from '../src/common/authz/principal';
import { DatabaseService } from '../src/common/tenancy/database.service';
import { AuthDatabase } from '../src/modules/auth/auth.database';
import { createAuth, type AuthInstance } from '../src/modules/auth/auth.factory';
import { AuthGateway } from '../src/modules/auth/auth.gateway';
import { AuthSessionStore } from '../src/modules/auth/auth-session.store';
import { AuthenticationGuard } from '../src/modules/auth/authentication.guard';
import { PrincipalRepository } from '../src/modules/auth/principal.repository';
import { seedAcademy, startTestDatabase, type SeededAcademy, type TestDatabase } from './support/harness';

/**
 * PROVES: authentication is a database row behind an httpOnly cookie. An account made
 * by the operator CLI signs in; the cookie resolves to a session on every request and
 * stops resolving the moment the session is gone; nobody can sign themselves up; and
 * the academy a session acts in is chosen by the server, from roles read now.
 *
 * better-auth runs here exactly as in the API: connected as `athlete_auth`, through
 * the same factory. Its HTTP routes are driven through `auth.handler` with real
 * `Request`s -- the same function `main.ts` mounts -- so cookie attributes and the
 * library's own refusals are observed, not assumed.
 */
const BASE_URL = 'http://localhost:3000';
const SECRET = 'integration-test-secret-of-at-least-32-characters';
const PASSWORD = 'correct horse battery staple';

describe('cookie sessions', () => {
  let db: TestDatabase;
  let alpha: SeededAcademy;
  let beta: SeededAcademy;
  let authDatabase: AuthDatabase;
  let database: DatabaseService;
  let auth: AuthInstance;
  let gateway: AuthGateway;
  let store: AuthSessionStore;
  let guard: AuthenticationGuard;

  const email = 'pat@example.test';
  let userId: string;

  /** A request to one of better-auth's own routes, as a same-origin browser would send it. */
  const post = (path: string, body: unknown, cookie?: string, origin = BASE_URL) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  const sessionCookieOf = (response: Response) =>
    response.headers.getSetCookie().find((value) => value.startsWith('athlete.session_token='));

  /** Signs in over HTTP and returns the `name=value` pair a browser would send back. */
  async function signIn(): Promise<string> {
    const response = await post('/sign-in/email', { email, password: PASSWORD });
    expect(response.status).toBe(200);
    const cookie = sessionCookieOf(response);
    if (!cookie) throw new Error('sign-in set no session cookie');
    return cookie.split(';')[0] as string;
  }

  /** Runs the real guard over a request carrying `cookie`, and returns what it attached. */
  async function authenticate(cookie: string | undefined) {
    const request: AuthenticatedRequest & { headers: Record<string, string> } = {
      headers: cookie ? { cookie } : {},
    };
    const appended: string[] = [];
    const response = { append: (_name: string, values: string[]) => appended.push(...values) };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;

    expect(await guard.canActivate(context)).toBe(true);
    return { request, appended };
  }

  const activeAcademyOf = async (sessionId: string) => {
    const { rows } = await db.adminPool.query<{ active_academy_id: string | null }>(
      'select active_academy_id from auth_sessions where id = $1',
      [sessionId],
    );
    return rows[0]?.active_academy_id;
  };

  beforeAll(async () => {
    db = await startTestDatabase();
    // Names chosen so "first by name" is Alpha, whichever was created first.
    beta = await seedAcademy(db, 'Beta Academy');
    alpha = await seedAcademy(db, 'Alpha Academy');

    // The operator CLI, as the owner.
    const created = await createUser(db.adminPool, {
      email: 'Pat@Example.test',
      name: 'Pat Example',
      academyId: alpha.academyId,
      role: 'coach',
      password: PASSWORD,
    });
    userId = created.userId;
    expect(created).toMatchObject({ created: true, roleGranted: true });

    // The API's wiring, by hand: better-auth on the auth role, lookups on the app role.
    authDatabase = new AuthDatabase(db.authUrl, 2);
    database = new DatabaseService(db.url, 2);
    auth = await createAuth({
      pool: authDatabase.pool,
      secret: SECRET,
      baseURL: BASE_URL,
      allowSignUp: false,
    });
    gateway = await AuthGateway.create(auth);
    store = new AuthSessionStore(authDatabase);
    guard = new AuthenticationGuard(gateway, database, new PrincipalRepository(), store);
  }, 180_000);

  afterAll(async () => {
    await authDatabase?.onModuleDestroy();
    await database?.onModuleDestroy();
    await db?.stop();
  });

  describe('accounts come from the operator CLI', () => {
    it('stores the password as a hash on the credential account, not on the user', async () => {
      const { rows } = await db.adminPool.query<{ provider_id: string; account_id: string; password: string }>(
        'select provider_id, account_id, password from auth_accounts where user_id = $1',
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provider_id: 'credential', account_id: userId });
      expect(rows[0]?.password).not.toContain(PASSWORD);
      expect(rows[0]?.password.length).toBeGreaterThan(64);

      const user = await db.adminPool.query('select * from users where id = $1', [userId]);
      // Lower-cased, so the unique index on lower(email) and the library agree.
      expect(user.rows[0]).toMatchObject({ email, full_name: 'Pat Example' });
      expect(Object.keys(user.rows[0])).not.toContain('password_hash');
    });

    it('creating an account signs nobody in', async () => {
      const { rows } = await db.adminPool.query('select 1 from auth_sessions where user_id = $1', [userId]);
      expect(rows).toHaveLength(0);
    });

    it('run again for the same email, it grants the role only and leaves the password alone', async () => {
      const before = await db.adminPool.query('select password from auth_accounts where user_id = $1', [userId]);

      const again = await createUser(db.adminPool, {
        email,
        name: 'Ignored Name',
        academyId: beta.academyId,
        role: 'academy_admin',
        password: 'a different password entirely',
      });
      expect(again).toEqual({ userId, created: false, roleGranted: true });

      const after = await db.adminPool.query('select password from auth_accounts where user_id = $1', [userId]);
      expect(after.rows).toEqual(before.rows);

      // A third time changes nothing at all.
      const third = await createUser(db.adminPool, { email, name: 'x', academyId: beta.academyId, role: 'academy_admin' });
      expect(third).toEqual({ userId, created: false, roleGranted: false });
    });

    it('refuses an unknown academy before creating anything', async () => {
      await expect(
        createUser(db.adminPool, {
          email: 'orphan@example.test',
          name: 'Orphan',
          academyId: '00000000-0000-4000-8000-000000000000',
          role: 'coach',
          password: PASSWORD,
        }),
      ).rejects.toThrow(/No academy with id/);
      const { rows } = await db.adminPool.query(`select 1 from users where email = 'orphan@example.test'`);
      expect(rows).toHaveLength(0);
    });

    it('a new account needs a password', async () => {
      await expect(
        createUser(db.adminPool, { email: 'nopw@example.test', name: 'No', academyId: alpha.academyId, role: 'coach' }),
      ).rejects.toThrow(/password is required/);
    });

    // The upgrade path: a `users` row from before better-auth, which is what the
    // fixture's users are -- a person and a role grant, and nothing to sign in with.
    it('a user row with no credential is given one, on the same id, and can then sign in', async () => {
      const legacyEmail = `coach+${alpha.academyId}@example.test`;
      const legacy = { email: legacyEmail, name: 'Ignored Name', academyId: alpha.academyId, role: 'coach' as const };

      // Granting a role to someone who could never use it is not a success.
      await expect(createUser(db.adminPool, legacy)).rejects.toThrow(/has no credential/);
      await expect(createUser(db.adminPool, { ...legacy, password: 'short' })).rejects.toThrow(/characters long/);

      const upgraded = await createUser(db.adminPool, { ...legacy, password: PASSWORD });
      // The same person: the role they already held is found, not granted again.
      expect(upgraded).toEqual({ userId: alpha.coachUserId, created: true, roleGranted: false });

      const { rows } = await db.adminPool.query<{ provider_id: string; account_id: string }>(
        'select provider_id, account_id from auth_accounts where user_id = $1',
        [alpha.coachUserId],
      );
      expect(rows).toEqual([{ provider_id: 'credential', account_id: alpha.coachUserId }]);

      const response = await post('/sign-in/email', { email: legacyEmail, password: PASSWORD });
      expect(response.status).toBe(200);
      const { session } = await gateway.resolveSession({ cookie: sessionCookieOf(response)?.split(';')[0] });
      expect(session).toMatchObject({ userId: alpha.coachUserId, email: legacyEmail });

      // From here it is an account like any other: the password is left alone.
      const again = await createUser(db.adminPool, { ...legacy, password: 'a different password entirely' });
      expect(again).toEqual({ userId: alpha.coachUserId, created: false, roleGranted: false });
      expect((await post('/sign-in/email', { email: legacyEmail, password: PASSWORD })).status).toBe(200);
    });
  });

  describe('signing in', () => {
    it('sets an httpOnly, SameSite=Lax cookie that resolves to the session', async () => {
      const response = await post('/sign-in/email', { email, password: PASSWORD });
      expect(response.status).toBe(200);

      const setCookie = sessionCookieOf(response) ?? '';
      expect(setCookie).toMatch(/;\s*HttpOnly/i);
      expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
      expect(setCookie).toMatch(/;\s*Path=\//i);

      const { session } = await gateway.resolveSession({ cookie: setCookie.split(';')[0] });
      expect(session).toMatchObject({ userId, email, name: 'Pat Example', activeAcademyId: null });
    });

    it('is a session ROW: the cookie carries its token and nothing about the user', async () => {
      const cookie = await signIn();
      const { session } = await gateway.resolveSession({ cookie });
      const { rows } = await db.adminPool.query<{ token: string; user_id: string }>(
        'select token, user_id from auth_sessions where id = $1',
        [session?.sessionId],
      );
      expect(rows[0]?.user_id).toBe(userId);
      expect(decodeURIComponent(cookie)).toContain(rows[0]?.token);
      expect(decodeURIComponent(cookie)).not.toContain(userId);
    });

    it('refuses a wrong password, and an unknown email, the same way', async () => {
      const wrong = await post('/sign-in/email', { email, password: 'not the password' });
      const unknown = await post('/sign-in/email', { email: 'nobody@example.test', password: PASSWORD });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(sessionCookieOf(wrong)).toBeUndefined();
      // Identical bodies: the answer does not say which half was wrong.
      expect(await wrong.json()).toEqual(await unknown.json());
    });

    it('refuses a sign-in posted from another origin', async () => {
      const cookie = await signIn();
      const response = await post('/sign-in/email', { email, password: PASSWORD }, cookie, 'https://evil.example');
      expect(response.status).toBe(403);
    });

    it('a cookie that was tampered with, or made up, resolves to nothing', async () => {
      const cookie = await signIn();
      expect((await gateway.resolveSession({ cookie: `${cookie}x` })).session).toBeNull();
      expect((await gateway.resolveSession({ cookie: 'athlete.session_token=made.up' })).session).toBeNull();
      expect((await gateway.resolveSession({})).session).toBeNull();
    });
  });

  describe('sign-up is closed', () => {
    it('the HTTP route refuses, and creates nobody', async () => {
      const response = await post('/sign-up/email', {
        email: 'intruder@example.test',
        name: 'Intruder',
        password: PASSWORD,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);

      const { rows } = await db.adminPool.query(`select 1 from users where email = 'intruder@example.test'`);
      expect(rows).toHaveLength(0);
    });

    it('so does a server-side call on the instance the API holds', async () => {
      await expect(
        auth.api.signUpEmail({ body: { email: 'intruder2@example.test', name: 'Intruder', password: PASSWORD } }),
      ).rejects.toThrow();

      const { rows } = await db.adminPool.query(`select 1 from users where email = 'intruder2@example.test'`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('signing out', () => {
    it('deletes the session row, so the old cookie resolves to nothing', async () => {
      const cookie = await signIn();
      const { session } = await gateway.resolveSession({ cookie });
      expect(session).not.toBeNull();

      const response = await post('/sign-out', {}, cookie);
      expect(response.status).toBe(200);

      const { rows } = await db.adminPool.query('select 1 from auth_sessions where id = $1', [session?.sessionId]);
      expect(rows).toHaveLength(0);
      // The very same cookie value, replayed: this is what a stolen cookie is worth afterwards.
      expect((await gateway.resolveSession({ cookie })).session).toBeNull();
      expect((await authenticate(cookie)).request.identity).toBeUndefined();
    });

    it('a session revoked in the database stops working on the next request: nothing is cached', async () => {
      const cookie = await signIn();
      expect((await authenticate(cookie)).request.identity?.userId).toBe(userId);

      await db.adminPool.query('delete from auth_sessions where user_id = $1', [userId]);
      expect((await authenticate(cookie)).request.identity).toBeUndefined();
    });
  });

  describe('the active academy', () => {
    it('an anonymous request gets no identity and costs no lookup', async () => {
      const { request, appended } = await authenticate(undefined);
      expect(request).toEqual({ headers: {} });
      expect(appended).toEqual([]);
    });

    it('a new session acts in the first academy by name, and that choice is persisted', async () => {
      const cookie = await signIn();
      const { request } = await authenticate(cookie);

      expect(request.identity).toMatchObject({ userId, email, name: 'Pat Example' });
      expect(request.memberships).toEqual([
        { id: alpha.academyId, name: 'Alpha Academy', roles: ['coach'] },
        { id: beta.academyId, name: 'Beta Academy', roles: ['academy_admin'] },
      ]);
      expect(request.principal).toEqual({ userId, academyId: alpha.academyId, roles: ['coach'] });
      expect(await activeAcademyOf(request.identity?.sessionId as string)).toBe(alpha.academyId);
    });

    it('the session keeps the academy it was switched to, with the roles held THERE', async () => {
      const cookie = await signIn();
      const first = await authenticate(cookie);
      await store.setActiveAcademy(first.request.identity?.sessionId as string, beta.academyId);

      const { request } = await authenticate(cookie);
      expect(request.principal).toEqual({ userId, academyId: beta.academyId, roles: ['academy_admin'] });
    });

    it('the browser cannot choose it: update-session does not accept the field', async () => {
      const cookie = await signIn();
      const { request } = await authenticate(cookie);
      const sessionId = request.identity?.sessionId as string;

      await post('/update-session', { activeAcademyId: beta.academyId }, cookie);
      await post('/update-session', { active_academy_id: beta.academyId }, cookie);

      expect(await activeAcademyOf(sessionId)).toBe(alpha.academyId);
      expect((await authenticate(cookie)).request.principal?.academyId).toBe(alpha.academyId);
    });

    it('falls back and is rewritten when the user no longer holds a role in it', async () => {
      const cookie = await signIn();
      const first = await authenticate(cookie);
      const sessionId = first.request.identity?.sessionId as string;
      await store.setActiveAcademy(sessionId, beta.academyId);
      expect((await authenticate(cookie)).request.principal?.academyId).toBe(beta.academyId);

      // The role is revoked while the session is live.
      await db.adminPool.query('delete from user_academy_roles where user_id = $1 and academy_id = $2', [
        userId,
        beta.academyId,
      ]);

      const { request } = await authenticate(cookie);
      expect(request.memberships?.map((membership) => membership.id)).toEqual([alpha.academyId]);
      expect(request.principal).toEqual({ userId, academyId: alpha.academyId, roles: ['coach'] });
      expect(await activeAcademyOf(sessionId)).toBe(alpha.academyId);
    });

    it('a user with no academy left is an identity without a principal', async () => {
      const cookie = await signIn();
      await db.adminPool.query('delete from user_academy_roles where user_id = $1', [userId]);

      const { request } = await authenticate(cookie);
      expect(request.identity?.userId).toBe(userId);
      expect(request.memberships).toEqual([]);
      expect(request.principal).toBeUndefined();
    });
  });

  describe('the client address behind reverse proxies', () => {
    // The address the sign-in rate limit counts by is the one better-auth records on
    // the session row, so the row shows which address a forwarded chain resolved to.
    const PROXIES = ['10.9.0.0/16', '198.51.100.20'];
    const CLIENT = '203.0.113.7';

    async function addressRecordedFor(instance: AuthInstance, forwardedFor: string) {
      const response = await instance.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: BASE_URL,
            'x-forwarded-for': forwardedFor,
          },
          body: JSON.stringify({ email, password: PASSWORD }),
        }),
      );
      expect(response.status).toBe(200);
      const cookie = (sessionCookieOf(response) ?? '').split(';')[0];
      const { session } = await gateway.resolveSession({ cookie });
      const { rows } = await db.adminPool.query<{ ip_address: string | null }>(
        'select ip_address from auth_sessions where id = $1',
        [session?.sessionId],
      );
      return rows[0]?.ip_address;
    }

    const behindProxies = () =>
      createAuth({
        pool: authDatabase.pool,
        secret: SECRET,
        baseURL: BASE_URL,
        allowSignUp: false,
        trustedProxies: PROXIES,
      });

    it('with the proxies named, a two-hop chain resolves to the client', async () => {
      const proxied = await behindProxies();
      expect(await addressRecordedFor(proxied, `${CLIENT}, 198.51.100.20, 10.9.4.4`)).toBe(CLIENT);
    });

    it('an address the client put at the front of the chain is never reached', async () => {
      const proxied = await behindProxies();
      expect(await addressRecordedFor(proxied, `1.2.3.4, ${CLIENT}, 10.9.4.4`)).toBe(CLIENT);
    });

    it('without them, no address in a chain is trusted: the case that shares one bucket in production', async () => {
      // `auth` is built with no trusted proxies. In production an unresolved address
      // puts every caller in one rate-limit bucket; under test the library substitutes
      // loopback. Either way it is NOT the client, which is what this pins down.
      expect(await addressRecordedFor(auth, `${CLIENT}, 198.51.100.20`)).not.toBe(CLIENT);
    });
  });

  describe('the roles do not cross', () => {
    it('the application role cannot read the session or the hash it just relied on', async () => {
      await expect(db.pool.query('select token from auth_sessions')).rejects.toThrow(/permission denied/i);
      await expect(db.pool.query('select password from auth_accounts')).rejects.toThrow(/permission denied/i);
    });

    it('the auth role cannot write the academy lookup it is not part of', async () => {
      const authPool = new Pool({ connectionString: db.authUrl, max: 1 });
      try {
        await expect(
          authPool.query(`insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, 'coach')`, [
            alpha.academyId,
            userId,
          ]),
        ).rejects.toThrow(/permission denied for table user_academy_roles/i);
      } finally {
        await authPool.end();
      }
    });
  });
});
