import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defineAbility } from './ability';
import {
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  type PermissionSpec,
} from './permission.decorator';
import type { Principal } from './principal';

/**
 * Registered globally, and DENY BY DEFAULT.
 *
 * A route carrying neither @Permission nor @Public is refused. Forgetting to declare
 * authorization is therefore a failing request and a failing test (see
 * test/authz.route-coverage.spec.ts), not an open endpoint -- the same fail-closed
 * principle RLS gives us at the data layer.
 *
 * The check is COARSE on purpose. Guards run before interceptors, so the tenant
 * transaction that resolves a coach's teams does not exist yet; the guard therefore
 * asks only "may this role ever do this?" from an ability built without conditions.
 * "To which rows?" is answered by the scoped ability on the request context.
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

    const spec = this.reflector.getAllAndOverride<PermissionSpec | undefined>(
      PERMISSION_METADATA,
      [handler, controller],
    );

    if (!spec) {
      throw new ForbiddenException(
        `Route ${controller.name}.${handler.name} declares no authorization. ` +
          'Add @Permission({ action, subject }) or @Public().',
      );
    }

    const request = context.switchToHttp().getRequest<{ principal?: Principal }>();
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException('Authentication required');

    const ability = defineAbility(principal, { scoped: false });
    if (!ability.can(spec.action, spec.subject)) {
      throw new ForbiddenException(
        `Cannot ${spec.action} ${spec.subject}. Principal holds: ${principal.roles.join(', ') || 'none'}.`,
      );
    }

    return true;
  }
}
