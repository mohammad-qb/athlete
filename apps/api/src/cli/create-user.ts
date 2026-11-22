import { randomBytes } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { Role, Uuid } from '@athlete/contracts';
import { Pool } from 'pg';
import { z } from 'zod';
import { createAuth } from '../modules/auth/auth.factory';

/**
 * Operator CLI: create an account and grant it a role in an academy.
 *
 * This is how an account comes to exist. Public sign-up is disabled in the API, there
 * is no invitation flow, and neither service role could do this anyway: `athlete_app`
 * holds nothing on `users`, and `athlete_auth` holds nothing on `user_academy_roles`.
 * So it runs with the OWNER connection in DATABASE_URL, the same way the migration job
 * does, and is run by the same people.
 *
 *   node dist/cli/create-user.js --email a@b.test --name "A B" \
 *     --academy <uuid> --role coach            # password read from stdin
 *
 * Running it again for an email that already has an account grants the role only: the
 * existing password is left alone, and no password is needed.
 *
 * A `users` row with no credential is not an account yet. Such rows exist: before
 * better-auth, a user was inserted directly and nothing stored a password. For one of
 * those the password is required, and it is attached to the existing row -- the id
 * stays, and with it every role grant and every history row that names it.
 */
export const CreateUserInput = z.strictObject({
  email: z.email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  academyId: Uuid,
  role: Role,
  /** Required when there is no credential yet; ignored for an account that has one. */
  password: z.string().min(1).optional(),
});
export type CreateUserInput = z.input<typeof CreateUserInput>;

export interface CreateUserResult {
  userId: string;
  /**
   * True when a credential was created: for a new user, or for a user row that had
   * none. False when the account already existed and only the role was considered.
   */
  created: boolean;
  /** False when the user already held this role in this academy. */
  roleGranted: boolean;
}

/**
 * Runs `fn` in a transaction with the tenant key set. The owner is subject to the
 * policies too (FORCE ROW LEVEL SECURITY), so an owner that is not a superuser -- the
 * production case -- can neither see the academy nor insert the grant without it.
 */
async function inAcademy<T>(
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

/**
 * Gives `input.email` a password, creating the user if `existingUserId` is undefined.
 * Returns the user's id.
 */
async function createCredential(
  pool: Pool,
  input: z.output<typeof CreateUserInput>,
  existingUserId: string | undefined,
): Promise<string> {
  if (!input.password) {
    throw new Error(
      existingUserId === undefined
        ? 'A password is required to create a new account'
        : `A password is required: ${input.email} exists but has no credential to sign in with`,
    );
  }

  // An instance of its own, with sign-up enabled and bound to no socket. The secret
  // signs session cookies and none is issued here (`autoSignIn: false`), so a
  // throwaway one keeps SESSION_SECRET out of the migration job's environment.
  const auth = await createAuth({
    pool,
    secret: randomBytes(48).toString('base64url'),
    baseURL: 'http://localhost',
    allowSignUp: true,
  });

  if (existingUserId === undefined) {
    const signedUp = await auth.api.signUpEmail({
      body: { email: input.email, name: input.name, password: input.password },
    });
    return signedUp.user.id;
  }

  // Sign-up refuses an email that is taken, and the library's own "set a password"
  // route needs a session, which this user cannot have. So this is the second half of
  // what sign-up does, by the same means: the library's length rule, its hash, and a
  // 'credential' account whose account_id is the user's id.
  const { password, internalAdapter } = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = password.config;
  if (input.password.length < minPasswordLength || input.password.length > maxPasswordLength) {
    throw new Error(`The password must be ${minPasswordLength} to ${maxPasswordLength} characters long`);
  }
  await internalAdapter.linkAccount({
    userId: existingUserId,
    providerId: 'credential',
    accountId: existingUserId,
    password: await password.hash(input.password),
  });
  return existingUserId;
}

export async function createUser(pool: Pool, raw: CreateUserInput): Promise<CreateUserResult> {
  const input = CreateUserInput.parse(raw);

  // Checked before the account is created, so a mistyped academy id does not leave a
  // user behind with a password and no role.
  const academy = await inAcademy(pool, input.academyId, (client) =>
    client.query('select 1 from academies where id = $1', [input.academyId]),
  );
  if (academy.rowCount === 0) throw new Error(`No academy with id ${input.academyId}`);

  const existing = await pool.query<{ id: string; has_credential: boolean }>(
    `select u.id,
            exists (
              select 1 from auth_accounts a
              where a.user_id = u.id and a.provider_id = 'credential'
            ) as has_credential
     from users u where lower(u.email) = $1`,
    [input.email],
  );

  const found = existing.rows[0];
  const created = found?.has_credential !== true;
  const userId = found?.has_credential ? found.id : await createCredential(pool, input, found?.id);

  const grant = await inAcademy(pool, input.academyId, (client) =>
    client.query(
      `insert into user_academy_roles (academy_id, user_id, role) values ($1, $2, $3)
       on conflict on constraint user_academy_roles_uq do nothing`,
      [input.academyId, userId, input.role],
    ),
  );

  return { userId, created, roleGranted: (grant.rowCount ?? 0) > 0 };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (the owner connection, as for migrations)');

  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      academy: { type: 'string' },
      role: { type: 'string' },
      password: { type: 'string' },
    },
    strict: true,
  });

  if (!values.email || !values.name || !values.academy || !values.role) {
    throw new Error(
      'usage: user:create --email <email> --name <full name> --academy <uuid> --role <role> ' +
        '[--password <password>]   (without --password, it is read from stdin)',
    );
  }

  // stdin is the default because an argument is visible in the process list and the
  // shell history. An interactive terminal with no --password is given nothing to
  // wait on: creating a new account will then report that a password is required.
  const password =
    values.password ?? (process.stdin.isTTY ? undefined : (await text(process.stdin)).replace(/\r?\n$/, ''));

  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const result = await createUser(pool, {
      email: values.email,
      name: values.name,
      academyId: values.academy,
      role: values.role as Role,
      password: password || undefined,
    });
    // The id alone on stdout, so a script can capture it; the narrative goes to stderr.
    console.error(
      `${result.created ? 'Created account for' : 'Found existing account for'} ${values.email}; ` +
        `role ${values.role} ${result.roleGranted ? 'granted' : 'already held'}.`,
    );
    console.log(result.userId);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof z.ZodError ? z.prettifyError(error) : (error as Error).message);
    process.exit(1);
  });
}
