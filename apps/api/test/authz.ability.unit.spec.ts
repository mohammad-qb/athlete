import { Action, Subject, type Role } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { asSubject, defineAbility } from '../src/common/authz/ability';
import type { Principal, PrincipalScope } from '../src/common/authz/principal';

/**
 * PROVES: one definition is the whole policy, and its two modes cannot disagree.
 *
 * No database: an ability is a pure function of a principal and a scope.
 */
const TEAM_A = '00000000-0000-0000-0000-00000000000a';
const TEAM_B = '00000000-0000-0000-0000-00000000000b';
const ATHLETE_A = '00000000-0000-0000-0000-0000000000a1';
const ATHLETE_B = '00000000-0000-0000-0000-0000000000b1';

const principal = (...roles: Role[]): Principal => ({
  userId: '00000000-0000-0000-0000-000000000001',
  academyId: '00000000-0000-0000-0000-000000000002',
  roles,
});

const scope = (activeTeamIds: string[], visibleAthleteIds: string[]): PrincipalScope => ({
  asOf: new Date('2026-06-01T00:00:00Z'),
  activeTeamIds,
  visibleAthleteIds,
});

const ASSIGNED = scope([TEAM_A], [ATHLETE_A]);
const UNASSIGNED = scope([], []);

const coarse = (...roles: Role[]) => defineAbility(principal(...roles), { scoped: false });
const scoped = (s: PrincipalScope, ...roles: Role[]) =>
  defineAbility(principal(...roles), { scoped: true, scope: s });

const pairs = Action.options.flatMap((action) =>
  Subject.options.map((subject) => ({ action, subject })),
);

const granted = (ability: ReturnType<typeof coarse>) =>
  pairs.filter(({ action, subject }) => ability.can(action, subject)).map(pairKey);

function pairKey({ action, subject }: { action: Action; subject: Subject }): string {
  return `${action}:${subject}`;
}

describe('defineAbility: grants per role', () => {
  it('platform_admin manages everything', () => {
    expect(granted(coarse('platform_admin'))).toEqual(pairs.map(pairKey));
    expect(granted(scoped(UNASSIGNED, 'platform_admin'))).toEqual(pairs.map(pairKey));
  });

  it('academy_admin manages every subject except role grants, which are read-only', () => {
    const ability = coarse('academy_admin');
    for (const subject of Subject.options) {
      for (const action of Action.options) {
        const expected = subject === 'userAcademyRoles' ? action === 'read' : true;
        expect(ability.can(action, subject), `${action} ${subject}`).toBe(expected);
      }
    }
  });

  it('academy_admin rules carry no conditions: tenancy is the database\'s job', () => {
    const ability = scoped(UNASSIGNED, 'academy_admin');
    expect(ability.rules.every((rule) => rule.conditions === undefined)).toBe(true);
  });

  it('coach holds exactly the operational grants', () => {
    expect(granted(coarse('coach')).sort()).toEqual(
      [
        'read:athletes',
        'update:athletes',
        'read:teams',
        'read:teamMemberships',
        'read:trainingSessions',
        'create:trainingSessions',
        'read:sessionParticipants',
        'create:sessionParticipants',
        'update:sessionParticipants',
      ].sort(),
    );
  });

  it('athlete holds nothing in this slice', () => {
    expect(granted(coarse('athlete'))).toEqual([]);
    expect(granted(scoped(ASSIGNED, 'athlete'))).toEqual([]);
  });

  it('a principal with no roles holds nothing', () => {
    expect(granted(coarse())).toEqual([]);
  });

  it('roles combine: a coach who is also an admin keeps the admin grants', () => {
    expect(granted(coarse('coach', 'academy_admin'))).toEqual(granted(coarse('academy_admin')));
  });
});

/**
 * The refactor guarantee for this phase. Before CASL each route listed the roles it
 * admitted; this table is that list, restated per operation. If the ability ever admits
 * or refuses a role differently from the route it replaced, this fails.
 */
describe('defineAbility: mirrors the role lists the routes declared before', () => {
  const legacy: { action: Action; subject: Subject; roles: Role[] }[] = [
    { action: 'read', subject: 'athletes', roles: ['academy_admin', 'coach'] },
    { action: 'create', subject: 'athletes', roles: ['academy_admin'] },
    { action: 'update', subject: 'athletes', roles: ['academy_admin', 'coach'] },
    { action: 'create', subject: 'teams', roles: ['academy_admin'] },
    { action: 'create', subject: 'teamMemberships', roles: ['academy_admin'] },
    { action: 'read', subject: 'teamMemberships', roles: ['academy_admin', 'coach'] },
    { action: 'update', subject: 'teamMemberships', roles: ['academy_admin'] },
    { action: 'create', subject: 'trainingSessions', roles: ['academy_admin', 'coach'] },
    { action: 'create', subject: 'sessionParticipants', roles: ['academy_admin', 'coach'] },
    { action: 'read', subject: 'sessionParticipants', roles: ['academy_admin', 'coach'] },
  ];

  it.each(legacy)('$action $subject', ({ action, subject, roles }) => {
    for (const role of ['academy_admin', 'coach', 'athlete'] as const) {
      expect(coarse(role).can(action, subject), role).toBe(roles.includes(role));
    }
  });
});

describe('defineAbility: coarse and scoped modes', () => {
  it('coarse rules never carry conditions', () => {
    for (const role of ROLES) {
      expect(coarse(role).rules.every((rule) => rule.conditions === undefined)).toBe(true);
    }
  });

  it('agree on which (action, subject) pairs exist when the principal has a scope', () => {
    for (const role of ROLES) {
      expect(granted(scoped(ASSIGNED, role)), role).toEqual(granted(coarse(role)));
    }
  });

  it('scoped never grants a pair the guard would refuse, whatever the scope', () => {
    const scopes = [ASSIGNED, UNASSIGNED, scope([TEAM_A], []), scope([], [ATHLETE_A])];
    for (const role of ROLES) {
      const admitted = new Set(granted(coarse(role)));
      for (const s of scopes) {
        for (const pair of granted(scoped(s, role))) {
          expect(admitted.has(pair), `${role} ${pair}`).toBe(true);
        }
      }
    }
  });

  it('a coach with no active assignment gets no rule at all, not a rule over an empty list', () => {
    const ability = scoped(UNASSIGNED, 'coach');
    expect(ability.rules).toEqual([]);
    expect(ability.can('read', 'athletes')).toBe(false);
  });
});

describe('defineAbility: scoped conditions evaluate in memory', () => {
  const ability = scoped(ASSIGNED, 'coach');

  it('admits rows of a team the coach currently coaches', () => {
    expect(ability.can('read', asSubject('athletes', { id: ATHLETE_A }))).toBe(true);
    expect(ability.can('read', asSubject('teams', { id: TEAM_A }))).toBe(true);
    expect(ability.can('read', asSubject('teamMemberships', { teamId: TEAM_A }))).toBe(true);
    expect(ability.can('create', asSubject('trainingSessions', { teamId: TEAM_A }))).toBe(true);
    expect(
      ability.can('create', asSubject('sessionParticipants', { teamIdAtTime: TEAM_A })),
    ).toBe(true);
  });

  it('refuses rows of any other team', () => {
    expect(ability.can('read', asSubject('athletes', { id: ATHLETE_B }))).toBe(false);
    expect(ability.can('read', asSubject('teams', { id: TEAM_B }))).toBe(false);
    expect(ability.can('read', asSubject('teamMemberships', { teamId: TEAM_B }))).toBe(false);
    expect(ability.can('create', asSubject('trainingSessions', { teamId: TEAM_B }))).toBe(false);
    expect(
      ability.can('update', asSubject('sessionParticipants', { teamIdAtTime: TEAM_B })),
    ).toBe(false);
  });

  it('an administrator passes an instance check on any row', () => {
    const admin = scoped(UNASSIGNED, 'academy_admin');
    expect(admin.can('update', asSubject('athletes', { id: ATHLETE_B }))).toBe(true);
  });

  it('asSubject tags a copy, leaving the row it was given untouched', () => {
    const row = { id: ATHLETE_A };
    asSubject('athletes', row);
    expect(Object.getOwnPropertyNames(row)).toEqual(['id']);
  });
});

const ROLES = ['platform_admin', 'academy_admin', 'coach', 'athlete'] as const;
