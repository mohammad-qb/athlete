import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInstance } from './auth.factory';

/** A session cookie, resolved against the database. */
export interface ResolvedSession {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  /** The academy this session last acted in. Not yet checked against the user's roles. */
  activeAcademyId: string | null;
}

export interface SessionLookup {
  session: ResolvedSession | null;
  /**
   * `Set-Cookie` values better-auth wants sent with the response: a refreshed expiry
   * when a session is renewed, a deletion when the cookie no longer resolves. A direct
   * `auth.api` call has no response to write them to, so the caller forwards them.
   */
  setCookies: string[];
}

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/**
 * The API's whole view of better-auth: mount its HTTP handler, and turn a request's
 * cookies into a session. Everything else the library can do is reached by the browser
 * through `/api/auth/*`, not by this code.
 *
 * It exists as a class of our own so that the guard depends on two methods rather than
 * on a library whose types are ESM-only, and so that a test can stand in for it.
 */
export class AuthGateway {
  constructor(
    private readonly auth: AuthInstance,
    private readonly node: typeof import('better-auth/node', { with: { 'resolution-mode': 'import' } }),
  ) {}

  static async create(auth: AuthInstance): Promise<AuthGateway> {
    return new AuthGateway(auth, await import('better-auth/node'));
  }

  /** better-auth's own routes (`/api/auth/*`), as a Node request handler. */
  nodeHandler(): NodeHandler {
    return this.node.toNodeHandler(this.auth);
  }

  /**
   * Reads the session row the cookie names -- every time. The cookie cache is off, so
   * a session that was revoked, or that belongs to a user who was removed, stops
   * resolving on the next request rather than when a cached copy expires.
   */
  async resolveSession(headers: IncomingHttpHeaders): Promise<SessionLookup> {
    const result = await this.auth.api.getSession({
      headers: this.node.fromNodeHeaders(headers),
      returnHeaders: true,
    });

    const setCookies = result.headers.getSetCookie();
    const found = result.response;
    if (!found) return { session: null, setCookies };

    return {
      session: {
        sessionId: found.session.id,
        userId: found.user.id,
        email: found.user.email,
        name: found.user.name,
        activeAcademyId: found.session.activeAcademyId ?? null,
      },
      setCookies,
    };
  }
}
