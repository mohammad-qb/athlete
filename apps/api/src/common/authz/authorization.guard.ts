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
  AUTHENTICATED_METADATA,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  type PermissionSpec,
} from './permission.decorator';
import type { AuthenticatedRequest } from './principal';

/**
 * Registered globally, and DENY BY DEFAULT.
 *
 * A route must carry exactly one of @Public, @Authenticated and @Permission. None is
 * refused, and so is more than one: two declarations disagree about who may call the
 * route, and picking either would be this guard guessing. Forgetting to declare
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
    const targets = [handler, controller];
    const route = `${controller.name}.${handler.name}`;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, targets) === true;
    const isAuthenticated =
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_METADATA, targets) === true;
    const spec = this.reflector.getAllAndOverride<PermissionSpec | undefined>(
      PERMISSION_METADATA,
      targets,
    );

    const declared = [isPublic, isAuthenticated, spec !== undefined].filter(Boolean).length;
    if (declared === 0) {
      throw new ForbiddenException(
        `Route ${route} declares no authorization. ` +
          'Add @Permission({ action, subject }), @Authenticated() or @Public().',
      );
    }
    if (declared > 1) {
      throw new ForbiddenException(
        `Route ${route} declares more than one authorization. ` +
          'Keep exactly one of @Permission, @Authenticated and @Public.',
      );
    }

    if (isPublic) return true;

    const { identity, principal } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (isAuthenticated) {
      if (!identity) throw new UnauthorizedException('Authentication required');
      return true;
    }

    if (!principal) {
      // Signed in, but holding no role in any academy: authenticating again would not
      // help, so this is a refusal (403) rather than a prompt to sign in (401).
      if (identity) {
        throw new ForbiddenException(
          `Cannot ${spec?.action} ${spec?.subject}. The account holds no role in any academy.`,
        );
      }
      throw new UnauthorizedException('Authentication required');
    }

    const ability = defineAbility(principal, { scoped: false });
    if (!spec || !ability.can(spec.action, spec.subject)) {
      throw new ForbiddenException(
        `Cannot ${spec?.action} ${spec?.subject}. Principal holds: ${principal.roles.join(', ') || 'none'}.`,
      );
    }

    return true;
  }
}
