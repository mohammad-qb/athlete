import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHZ_METADATA,
  PUBLIC_METADATA,
  type AuthorizeSpec,
} from './authorize.decorator';
import type { Principal } from '../tenancy/request-context';

/**
 * Registered globally, and DENY BY DEFAULT.
 *
 * A route carrying neither @Authorize nor @Public is refused. Forgetting to declare
 * authorization is therefore a failing request and a failing test (see
 * test/authz.route-coverage.spec.ts), not an open endpoint -- the same fail-closed
 * principle RLS gives us at the data layer.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, [
      handler,
      controller,
    ]);
    if (isPublic) return true;

    const spec = this.reflector.getAllAndOverride<AuthorizeSpec | undefined>(
      AUTHZ_METADATA,
      [handler, controller],
    );

    if (!spec) {
      throw new ForbiddenException(
        `Route ${controller.name}.${handler.name} declares no authorization. ` +
          'Add @Authorize({ roles: [...] }) or @Public().',
      );
    }

    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const permitted = principal.roles.some((role) => spec.roles.includes(role));
    if (!permitted) {
      throw new ForbiddenException(
        `Requires one of: ${spec.roles.join(', ')}. Principal holds: ${principal.roles.join(', ') || 'none'}.`,
      );
    }

    return true;
  }
}
