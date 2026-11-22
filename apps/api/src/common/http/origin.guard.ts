import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError, ApiErrorType } from '../errors/api.error';

/** Methods that must not change state, and so need no origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for our own routes, registered as the FIRST global guard.
 *
 * Authentication is a cookie, and a browser attaches a cookie to a request no matter
 * which site caused it. SameSite=Lax already withholds the cookie from a cross-site
 * POST; this is the second, independent check, and the one that does not depend on a
 * browser's cookie rules: a state-changing request that says where it came from must
 * have come from the application's own origin.
 *
 * A request with NO `Origin` header passes. Browsers send the header on every request
 * that is not a GET or HEAD, so its absence means a non-browser client (curl, a server,
 * a test) -- which has no ambient cookie for an attacker to borrow.
 *
 * better-auth applies its own origin check to `/api/auth/*`; those routes never reach
 * a Nest guard.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(appBaseUrl: string) {
    this.allowedOrigin = new URL(appBaseUrl).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const origin = request.headers.origin;
    if (origin === undefined) return true;

    // Compared as an exact string: scheme, host and port all have to match, and the
    // literal "null" a sandboxed frame sends matches nothing.
    if (origin !== this.allowedOrigin) {
      throw new ApiError('This request did not come from the application', {
        type: ApiErrorType.FORBIDDEN,
        code: 'invalid_origin',
        explanation: 'State-changing requests are accepted from the application origin only.',
      });
    }

    return true;
  }
}
