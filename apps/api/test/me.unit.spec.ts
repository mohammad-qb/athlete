import { PermissionAction, Subject, type Role } from '@athlete/contracts';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { defineAbility } from '../src/common/authz/ability';
import type { AcademyMembership } from '../src/common/authz/principal';
import { ApiError } from '../src/common/errors/api.error';
import type { AuthSessionStore } from '../src/modules/auth/auth-session.store';
import { resolveActiveAcademy } from '../src/modules/auth/authentication.guard';
import {
  readCurrentSession,
  type CurrentSessionValue,
} from '../src/modules/auth/current-session.decorator';
import { MeService, permissionsFor, toMeResponse } from '../src/modules/auth/me.service';

/**
 * PROVES: `/me` reports what the policy grants -- by asking it, not by restating it --
 * and switching academy is confined to academies the user belongs to.
 */
const ALPHA: AcademyMembership = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Alpha', roles: ['academy_admin'] };
const BETA: AcademyMembership = { id: 'b0000000-0000-4000-8000-000000000002', name: 'Beta', roles: ['coach'] };
const identity = { userId: 'u0000000-0000-4000-8000-000000000003', email: 'p@example.test', name: 'P', sessionId: 's1' };

const principalWith = (roles: Role[]) => ({ userId: identity.userId, academyId: ALPHA.id, roles });
const pairs = (roles: Role[]) =>
  permissionsFor(principalWith(roles)).map(({ action, subject }) => `${action} ${subject}`);

describe('permissionsFor', () => {
  it.each([['academy_admin'], ['coach'], ['platform_admin'], ['athlete'], ['coach', 'academy_admin']] as Role[][])(
    'lists exactly the pairs the coarse ability grants: %s',
    (...roles) => {
      const ability = defineAbility(principalWith(roles), { scoped: false });
      const expected = Subject.options.flatMap((subject) =>
        PermissionAction.options
          .filter((action) => ability.can(action, subject))
          .map((action) => `${action} ${subject}`),
      );
      expect(pairs(roles)).toEqual(expected);
    },
  );

  it('an administrator may create athletes and may not write role grants', () => {
    const admin = pairs(['academy_admin']);
    expect(admin).toContain('create athletes');
    expect(admin).toContain('read userAcademyRoles');
    expect(admin).not.toContain('create userAcademyRoles');
  });

  it('a coach may update athletes and record attendance, and may not create athletes or teams', () => {
    const coach = pairs(['coach']);
    expect(coach).toEqual(
      expect.arrayContaining(['update athletes', 'create trainingSessions', 'create sessionParticipants']),
    );
    expect(coach).not.toContain('create athletes');
    expect(coach).not.toContain('create teams');
    expect(coach).not.toContain('delete athletes');
  });

  it('never reports the wildcard: `manage` is expanded into the four concrete actions', () => {
    const platform = permissionsFor(principalWith(['platform_admin']));
    expect(platform.map((p) => p.action)).not.toContain('manage');
    expect(platform).toHaveLength(Subject.options.length * PermissionAction.options.length);
  });

  it('no principal gives an empty list', () => {
    expect(permissionsFor(undefined)).toEqual([]);
  });

  it('a role with no grants gives an empty list', () => {
    expect(pairs(['athlete'])).toEqual([]);
  });
});

describe('toMeResponse', () => {
  it('describes an account that belongs to no academy', () => {
    expect(toMeResponse({ identity, memberships: [] })).toEqual({
      user: { id: identity.userId, email: identity.email, name: identity.name },
      activeAcademyId: null,
      academies: [],
      permissions: [],
    });
  });

  it('reports every academy, and the permissions of the ACTIVE one only', () => {
    const me = toMeResponse({
      identity,
      memberships: [ALPHA, BETA],
      principal: { userId: identity.userId, academyId: BETA.id, roles: BETA.roles },
    });
    expect(me.activeAcademyId).toBe(BETA.id);
    expect(me.academies).toEqual([ALPHA, BETA]);
    expect(me.permissions).toEqual(permissionsFor(principalWith(['coach'])));
  });

  it('does not leak the session id', () => {
    expect(JSON.stringify(toMeResponse({ identity, memberships: [ALPHA] }))).not.toContain('s1');
  });
});

describe('MeService.switchAcademy', () => {
  const session: CurrentSessionValue = {
    identity,
    memberships: [ALPHA, BETA],
    principal: { userId: identity.userId, academyId: ALPHA.id, roles: ALPHA.roles },
  };
  const storeWith = (setActiveAcademy = vi.fn(() => Promise.resolve())) => ({
    setActiveAcademy,
    service: new MeService({ setActiveAcademy } as unknown as AuthSessionStore),
  });

  it('moves the session and answers with the new academy and its permissions', async () => {
    const { service, setActiveAcademy } = storeWith();
    const me = await service.switchAcademy(session, BETA.id);

    expect(setActiveAcademy).toHaveBeenCalledWith('s1', BETA.id);
    expect(me.activeAcademyId).toBe(BETA.id);
    expect(me.permissions).toEqual(permissionsFor(principalWith(['coach'])));
  });

  it('refuses an academy the user holds no role in, and writes nothing', async () => {
    const { service, setActiveAcademy } = storeWith();
    const refused = await service
      .switchAcademy(session, 'c0000000-0000-4000-8000-000000000009')
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ statusCode: 403, code: 'not_a_member' });
    expect(setActiveAcademy).not.toHaveBeenCalled();
  });
});

describe('resolveActiveAcademy', () => {
  it('keeps the academy the session chose while the user still belongs to it', () => {
    expect(resolveActiveAcademy([ALPHA, BETA], BETA.id)).toBe(BETA);
  });

  it('falls back to the first academy when the chosen one is no longer the user’s', () => {
    expect(resolveActiveAcademy([ALPHA, BETA], 'c0000000-0000-4000-8000-000000000009')).toBe(ALPHA);
  });

  it('picks the first academy for a session that has not chosen yet', () => {
    expect(resolveActiveAcademy([ALPHA, BETA], null)).toBe(ALPHA);
  });

  it('has no answer for a user who belongs to no academy', () => {
    expect(resolveActiveAcademy([], BETA.id)).toBeUndefined();
  });
});

describe('@CurrentSession', () => {
  const contextFor = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getClass: () => ({ name: 'MeController' }),
      getHandler: () => ({ name: 'read' }),
    }) as unknown as ExecutionContext;

  it('hands over what the authentication guard resolved', () => {
    expect(readCurrentSession(undefined, contextFor({ identity, memberships: [ALPHA] }))).toEqual({
      identity,
      memberships: [ALPHA],
      principal: undefined,
    });
  });

  it('fails closed on a route that admits anonymous requests: a 500, reason in the log only', () => {
    const read = () => readCurrentSession(undefined, contextFor({}));
    expect(read).toThrow(ApiError);
    expect(read).toThrow('Internal server error');
  });
});
