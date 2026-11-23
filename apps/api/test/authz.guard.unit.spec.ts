import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { AuthorizationGuard } from '../src/common/authz/authorization.guard';
import { Authenticated, Permission, Public } from '../src/common/authz/permission.decorator';

/**
 * PROVES: the guard denies by default and decides from the ability, not from a role
 * list on the route.
 */
class Routes {
  @Permission({ action: 'create', subject: 'athletes' })
  createAthlete(): void {}

  @Permission({ action: 'read', subject: 'athletes' })
  readAthletes(): void {}

  @Public()
  open(): void {}

  @Authenticated()
  whoAmI(): void {}

  @Public()
  @Permission({ action: 'read', subject: 'athletes' })
  publicAndPermission(): void {}

  @Authenticated()
  @Permission({ action: 'read', subject: 'athletes' })
  authenticatedAndPermission(): void {}

  @Public()
  @Authenticated()
  publicAndAuthenticated(): void {}

  undeclared(): void {}
}

/** Declares at class level what one handler then declares differently. */
@Public()
class OpenRoutes {
  inherited(): void {}

  @Permission({ action: 'read', subject: 'athletes' })
  contradictory(): void {}
}

const guard = new AuthorizationGuard(new Reflector());

const identity = { userId: 'u', email: 'u@example.test', name: 'U', sessionId: 's' };

function contextOn(controller: { prototype: object }, handler: string, request: object) {
  return {
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** `roles` given: signed in with a principal in an academy. Omitted: anonymous. */
function contextFor(handler: keyof Routes, roles?: Role[]): ExecutionContext {
  const request = roles
    ? { identity, memberships: [], principal: { userId: 'u', academyId: 'a', roles } }
    : {};
  return contextOn(Routes, handler, request);
}

/** Signed in, but holding no role in any academy: an identity and no principal. */
const withoutAcademy = (handler: keyof Routes) => contextOn(Routes, handler, { identity, memberships: [] });

describe('AuthorizationGuard', () => {
  it('refuses a route that declares nothing, even for an administrator', () => {
    expect(() => guard.canActivate(contextFor('undeclared', ['platform_admin']))).toThrow(
      /declares no authorization/,
    );
    expect(() => guard.canActivate(contextFor('undeclared', ['platform_admin']))).toThrow(
      ForbiddenException,
    );
  });

  it('admits a @Public route with no principal', () => {
    expect(guard.canActivate(contextFor('open'))).toBe(true);
  });

  it('answers 401, not 403, when there is no principal', () => {
    expect(() => guard.canActivate(contextFor('readAthletes'))).toThrow(UnauthorizedException);
  });

  it('admits a role the policy grants the operation to', () => {
    expect(guard.canActivate(contextFor('readAthletes', ['coach']))).toBe(true);
    expect(guard.canActivate(contextFor('createAthlete', ['academy_admin']))).toBe(true);
  });

  it('refuses a role the policy does not grant it to, naming the operation', () => {
    expect(() => guard.canActivate(contextFor('createAthlete', ['coach']))).toThrow(
      'Cannot create athletes. Principal holds: coach.',
    );
    expect(() => guard.canActivate(contextFor('readAthletes', ['athlete']))).toThrow(
      ForbiddenException,
    );
  });

  describe('@Authenticated', () => {
    it('admits an identity that has no principal: an account with no academy may ask who it is', () => {
      expect(guard.canActivate(withoutAcademy('whoAmI'))).toBe(true);
    });

    it('admits an identity with a principal, whatever its roles', () => {
      expect(guard.canActivate(contextFor('whoAmI', ['athlete']))).toBe(true);
    });

    it('refuses an anonymous request with 401', () => {
      expect(() => guard.canActivate(contextFor('whoAmI'))).toThrow(UnauthorizedException);
    });

    it('does not stand in for a permission: no academy means 403 on a @Permission route', () => {
      expect(() => guard.canActivate(withoutAcademy('readAthletes'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(withoutAcademy('readAthletes'))).toThrow(
        /holds no role in any academy/,
      );
    });
  });

  describe('exactly one declaration', () => {
    it.each(['publicAndPermission', 'authenticatedAndPermission', 'publicAndAuthenticated'] as const)(
      'refuses a route with two, even for an administrator: %s',
      (handler) => {
        expect(() => guard.canActivate(contextFor(handler, ['platform_admin']))).toThrow(
          /declares more than one authorization/,
        );
        expect(() => guard.canActivate(contextFor(handler, ['platform_admin']))).toThrow(
          ForbiddenException,
        );
      },
    );

    it('a class-level @Public does not open a handler that declares a permission', () => {
      expect(guard.canActivate(contextOn(OpenRoutes, 'inherited', {}))).toBe(true);
      expect(() => guard.canActivate(contextOn(OpenRoutes, 'contradictory', {}))).toThrow(
        /declares more than one authorization/,
      );
    });
  });
});
