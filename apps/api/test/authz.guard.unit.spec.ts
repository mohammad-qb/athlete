import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { AuthorizationGuard } from '../src/common/authz/authorization.guard';
import { Permission, Public } from '../src/common/authz/permission.decorator';

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

  undeclared(): void {}
}

const guard = new AuthorizationGuard(new Reflector());

function contextFor(handler: keyof Routes, roles?: Role[]): ExecutionContext {
  const request = roles ? { principal: { userId: 'u', academyId: 'a', roles } } : {};
  return {
    getHandler: () => (Routes.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

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
});
