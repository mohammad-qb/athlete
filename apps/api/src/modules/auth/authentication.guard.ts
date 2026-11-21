import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { SessionService } from './session.service';
import type { Principal } from '../../common/tenancy/request-context';

/**
 * Attaches a verified principal to the request, or nothing at all. It never refuses:
 * deciding whether anonymity is acceptable belongs to AuthorizationGuard, and keeping
 * that decision in exactly one place is what makes deny-by-default auditable.
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
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      principal?: Principal;
    }>();

    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const principal = this.sessions.verify(header.slice('Bearer '.length).trim());
      if (principal) request.principal = principal;
    }

    return true;
  }
}
