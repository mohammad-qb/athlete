import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { AcademyMembership, AuthenticatedRequest } from '../../common/authz/principal';
import { DatabaseService } from '../../common/tenancy/database.service';
import { AuthGateway } from './auth.gateway';
import { AuthSessionStore } from './auth-session.store';
import { PrincipalRepository } from './principal.repository';

/**
 * The academy a session acts in: the one it last chose, if the user still holds a role
 * there; otherwise the first by name. `undefined` when the user belongs to none.
 *
 * Pure, so the fallback rule is unit-tested without a database.
 */
export function resolveActiveAcademy(
  memberships: AcademyMembership[],
  sessionActiveAcademyId: string | null,
): AcademyMembership | undefined {
  return (
    memberships.find((membership) => membership.id === sessionActiveAcademyId) ?? memberships[0]
  );
}

/**
 * Attaches a verified identity and principal to the request, or nothing at all. It
 * never refuses: deciding whether anonymity is acceptable belongs to
 * AuthorizationGuard, and keeping that decision in exactly one place is what makes
 * deny-by-default auditable.
 *
 * Three database reads per authenticated request, and that is the design rather than
 * an oversight: the session row (is this cookie still valid?), the user's roles (what
 * do they hold NOW?) and -- later, in the tenant transaction -- a coach's teams. None
 * is cached, so revoking a session or a role takes effect on the next request.
 *
 * This is a global guard rather than middleware, deliberately. Nest 11 runs on
 * Express 5 / path-to-regexp v8, where a middleware registered for the path '*'
 * silently matches nothing -- the kind of failure that produces a uniformly 401 API
 * with no error anywhere. A guard has no path pattern to get wrong, and global guards
 * run before interceptors, so TenantTransactionInterceptor can still read the
 * principal it needs to open the tenant transaction.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly auth: AuthGateway,
    private readonly database: DatabaseService,
    private readonly principals: PrincipalRepository,
    private readonly sessions: AuthSessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest & { headers: IncomingHttpHeaders }>();

    // No cookie, no session: an anonymous request (a health probe above all) costs no
    // database round-trip.
    if (!request.headers.cookie) return true;

    const { session, setCookies } = await this.auth.resolveSession(request.headers);
    if (setCookies.length > 0) {
      http
        .getResponse<{ append(name: string, value: string[]): unknown }>()
        .append('Set-Cookie', setCookies);
    }
    if (!session) return true;

    // Unscoped on purpose: which academy applies is the QUESTION here, so there is no
    // tenant key to set yet. RLS therefore hides every tenant-owned row from this
    // transaction; the one audited function is all it can read across academies.
    const memberships = await this.database.runUnscoped((tx) =>
      this.principals.academiesFor(tx, session.userId),
    );
    request.identity = {
      userId: session.userId,
      email: session.email,
      name: session.name,
      sessionId: session.sessionId,
    };
    request.memberships = memberships;

    const active = resolveActiveAcademy(memberships, session.activeAcademyId);
    // Signed in, but a member of nothing: an identity with no principal. `/me` still
    // answers; every `@Permission` route refuses.
    if (!active) return true;

    // First request of a session, or the academy it was acting in is no longer the
    // user's: persist the choice so every later request -- and every other tab -- acts
    // in the same academy instead of re-deriving it.
    if (active.id !== session.activeAcademyId) {
      await this.sessions.setActiveAcademy(session.sessionId, active.id);
    }

    request.principal = { userId: session.userId, academyId: active.id, roles: active.roles };
    return true;
  }
}
