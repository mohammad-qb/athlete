import type { Pool } from 'pg';

export interface CreateAuthOptions {
  /** Connected as `athlete_auth` when serving requests; as the owner in the operator CLI. */
  pool: Pool;
  /** Signs session cookies. 32+ characters. */
  secret: string;
  /** The browser-facing origin (APP_BASE_URL). */
  baseURL: string;
  /**
   * True only for the operator CLI. With sign-up disabled, better-auth refuses the
   * server-side `auth.api.signUpEmail` as well as the HTTP route, so the CLI needs an
   * instance of its own -- one that is never mounted on a socket.
   */
  allowSignUp: boolean;
  /**
   * IPs or CIDR ranges of the reverse proxies in front of the API
   * (AUTH_TRUSTED_PROXIES). Omitted or empty when it is reached directly.
   */
  trustedProxies?: string[];
}

/** Where better-auth's routes are mounted. Not under the versioned prefix: it is the library's API, not ours. */
export const AUTH_BASE_PATH = '/api/auth';

/** `<prefix>.session_token`, or `__Secure-<prefix>.session_token` when the base URL is https. */
export const AUTH_COOKIE_PREFIX = 'athlete';

/** The session cookie over http. Published in the OpenAPI document as the security scheme. */
export const SESSION_COOKIE_NAME = `${AUTH_COOKIE_PREFIX}.session_token`;

/**
 * THE better-auth configuration. Every option that carries a security decision is
 * stated here even where it restates a default, so a default changing upstream is a
 * diff in this file rather than a behaviour change nobody reviewed.
 *
 * `await import()` rather than `import`: better-auth is published as ES modules only
 * and this API compiles to CommonJS. Under `module: node16` a dynamic import is left
 * as a real `import()` in the output, which is the one form CommonJS may load an ES
 * module with on every Node version this runs on -- the built image, ts-node-dev and
 * Vitest alike.
 */
export async function createAuth(options: CreateAuthOptions) {
  const { betterAuth } = await import('better-auth');

  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    // The SPA is same-origin. Nothing else may drive these routes from a browser.
    trustedOrigins: [options.baseURL],

    // A `pg.Pool`, handed to better-auth's built-in query layer. NOT the Drizzle
    // adapter: that needs drizzle-orm >= 0.45.2, and it would put the auth tables in
    // the schema the application role's queries are built from.
    database: options.pool,

    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      // Creating an account is not signing in. The CLI must not leave a session behind.
      autoSignIn: false,
    },

    // Our tables and our column names. With a pool passed directly, `modelName` is the
    // SQL table and each `fields` value the SQL column.
    user: {
      modelName: 'users',
      fields: {
        name: 'full_name',
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        // Which academy the session acts in. `input: false` is the point: without it
        // the browser could set this through POST /api/auth/update-session and choose
        // its own tenant. It is written by AuthSessionStore and by nothing else.
        activeAcademyId: {
          type: 'string',
          required: false,
          input: false,
          fieldName: 'active_academy_id',
        },
      },
      // Off, and it is the default: with the cookie cache on, a session lives in a
      // signed cookie for a while and a revoked session keeps working until it lapses.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // Ids are Postgres uuids from each table's own default, like every other id here.
      database: { generateId: 'uuid' },
      // Stated because the default is NOT constant: better-auth switches its origin
      // check off when it detects a test environment, so a suite would otherwise
      // exercise a more permissive library than the one that ships.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Whose sign-in attempts are being counted. Behind Front Door and the Container
      // Apps ingress, X-Forwarded-For is a chain, and better-auth trusts no address in
      // a chain unless told which hops are proxies: it then keys EVERY caller into one
      // shared bucket, so three attempts by anyone lock sign-in for everyone. With the
      // proxies named, the chain is read right to left and the first address that is
      // not a proxy is the client -- a value the client put on the left is never
      // reached. Left unset when there are none: a single-value header is then used
      // as it stands.
      ...(options.trustedProxies && options.trustedProxies.length > 0
        ? { ipAddress: { trustedProxies: options.trustedProxies } }
        : {}),
    },

    // Data residency: this process makes no request to a third party.
    telemetry: { enabled: false },
  });
}

export type AuthInstance = Awaited<ReturnType<typeof createAuth>>;
