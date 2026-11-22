import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { accessibleBy } from '../src/common/authz/accessible-by';
import { defineAbility, type AppAbility } from '../src/common/authz/ability';
import { ApiError, ApiErrorType } from '../src/common/errors';

/**
 * PROVES: the query filter derived from an ability is never silently permissive. No
 * grant is a FORBIDDEN error, not an unfiltered query.
 */
const athletes = pgTable('athletes', { id: uuid('id').primaryKey() });
const columns = { id: athletes.id };

const dialect = new PgDialect();
const render = (ability: AppAbility) => {
  const where = accessibleBy(ability, 'read', 'athletes', columns);
  return where ? dialect.sqlToQuery(where) : undefined;
};

const build = (define: (b: AbilityBuilder<AppAbility>) => void): AppAbility => {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  define(builder);
  return builder.build();
};

const base = { userId: 'u', academyId: 'a' };
const scope = (visibleAthleteIds: string[]) => ({
  asOf: new Date(),
  activeTeamIds: visibleAthleteIds.length ? ['t1'] : [],
  visibleAthleteIds,
});

describe('accessibleBy', () => {
  it('throws FORBIDDEN when no rule grants the action', () => {
    const ability = build(() => undefined);
    expect(() => render(ability)).toThrow(ApiError);
    try {
      render(ability);
    } catch (error) {
      expect(error).toMatchObject({
        type: ApiErrorType.FORBIDDEN,
        statusCode: 403,
        code: 'AUTHZ_NO_GRANT',
        meta: { action: 'read', subject: 'athletes' },
      });
    }
  });

  it('throws when the only grant is for a different action or subject', () => {
    expect(() => render(build(({ can }) => can('create', 'athletes')))).toThrow(ApiError);
    expect(() => render(build(({ can }) => can('read', 'teams')))).toThrow(ApiError);
  });

  it('an unconditional grant is no restriction', () => {
    expect(render(build(({ can }) => can('read', 'athletes')))).toBeUndefined();
    expect(render(build(({ can }) => can('manage', 'all')))).toBeUndefined();
  });

  it('a conditional grant is its predicate', () => {
    expect(render(build(({ can }) => can('read', 'athletes', { id: { $in: ['a1', 'a2'] } })))).toMatchObject({
      sql: '"athletes"."id" in ($1, $2)',
      params: ['a1', 'a2'],
    });
  });

  it('several grants are OR-ed', () => {
    const ability = build(({ can }) => {
      can('read', 'athletes', { id: 'a1' });
      can('read', 'athletes', { id: 'a2' });
    });
    // Highest priority (defined last) first.
    expect(render(ability)?.sql).toBe('("athletes"."id" = $1 or "athletes"."id" = $2)');
    expect(render(ability)?.params).toEqual(['a2', 'a1']);
  });

  it('an unconditional grant absorbs conditional ones', () => {
    const ability = build(({ can }) => {
      can('read', 'athletes', { id: 'a1' });
      can('manage', 'all');
    });
    expect(render(ability)).toBeUndefined();
  });

  it('a later cannot is AND-ed onto the grant as a negation', () => {
    const ability = build(({ can, cannot }) => {
      can('read', 'athletes', { id: { $in: ['a1', 'a2'] } });
      cannot('read', 'athletes', { id: 'a2' });
    });
    expect(render(ability)?.sql).toBe(
      '("athletes"."id" in ($1, $2) and ("athletes"."id" = $3) is not true)',
    );
  });

  it('a cannot restricts an otherwise unrestricted grant', () => {
    const ability = build(({ can, cannot }) => {
      can('read', 'athletes');
      cannot('read', 'athletes', { id: 'a2' });
    });
    expect(render(ability)?.sql).toBe('("athletes"."id" = $1) is not true');
  });

  it('an unconditional cannot defined last denies outright', () => {
    const ability = build(({ can, cannot }) => {
      can('read', 'athletes');
      cannot('read', 'athletes');
    });
    expect(() => render(ability)).toThrow(ApiError);
  });

  it('a condition on an unmapped field throws rather than being dropped', () => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'athletes', conditions: { teamId: 't1' } },
    ]) as unknown as AppAbility;
    expect(() => render(ability)).toThrow(/not a mapped column/);
  });

  describe('with the real policy', () => {
    it('an administrator is unrestricted', () => {
      const ability = defineAbility(
        { ...base, roles: ['academy_admin'] },
        { scoped: true, scope: scope([]) },
      );
      expect(render(ability)).toBeUndefined();
    });

    it('a coach is confined to their visible athletes', () => {
      const ability = defineAbility(
        { ...base, roles: ['coach'] },
        { scoped: true, scope: scope(['a1']) },
      );
      expect(render(ability)).toMatchObject({ sql: '"athletes"."id" in ($1)', params: ['a1'] });
    });

    it('a coach with no active assignment is refused, not handed an empty page', () => {
      const ability = defineAbility(
        { ...base, roles: ['coach'] },
        { scoped: true, scope: scope([]) },
      );
      expect(() => render(ability)).toThrow(ApiError);
    });

    it('an athlete is refused', () => {
      const ability = defineAbility(
        { ...base, roles: ['athlete'] },
        { scoped: true, scope: scope([]) },
      );
      expect(() => render(ability)).toThrow(ApiError);
    });
  });
});
