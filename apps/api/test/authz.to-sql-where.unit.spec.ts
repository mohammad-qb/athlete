import { createMongoAbility, subject } from '@casl/ability';
import { PgDialect, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { toSqlWhere } from '../src/common/authz/to-sql-where';

/**
 * PROVES: a condition compiles to the predicate it says, and anything the compiler
 * does not understand is an error rather than a dropped restriction.
 *
 * Rendered with Drizzle's own Postgres dialect, so the assertions are on the SQL text
 * and bound parameters a query would actually send. No database needed.
 */
const things = pgTable('things', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id'),
  rank: integer('rank'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
});
const columns = {
  id: things.id,
  teamId: things.teamId,
  rank: things.rank,
  startsAt: things.startsAt,
};

const dialect = new PgDialect();
function render(condition: unknown): { sql: string; params: unknown[] } | undefined {
  const where = toSqlWhere(condition, columns);
  if (!where) return undefined;
  const query = dialect.sqlToQuery(where);
  return { sql: query.sql, params: query.params };
}

describe('toSqlWhere: comparisons', () => {
  it('an empty condition is no restriction', () => {
    expect(render({})).toBeUndefined();
  });

  it('a bare value is equality', () => {
    expect(render({ id: 'a' })).toEqual({ sql: '"things"."id" = $1', params: ['a'] });
    expect(render({ id: { $eq: 'a' } })).toEqual(render({ id: 'a' }));
  });

  it('$gt $gte $lt $lte', () => {
    expect(render({ id: { $gt: 'a' } })?.sql).toBe('"things"."id" > $1');
    expect(render({ id: { $gte: 'a' } })?.sql).toBe('"things"."id" >= $1');
    expect(render({ id: { $lt: 'a' } })?.sql).toBe('"things"."id" < $1');
    expect(render({ id: { $lte: 'a' } })?.sql).toBe('"things"."id" <= $1');
  });

  it('several operators on one field are AND-ed', () => {
    expect(render({ id: { $gte: 'a', $lt: 'f' } })).toEqual({
      sql: '("things"."id" >= $1 and "things"."id" < $2)',
      params: ['a', 'f'],
    });
  });

  it('several fields are AND-ed', () => {
    expect(render({ id: 'a', rank: 2 })?.sql).toBe('("things"."id" = $1 and "things"."rank" = $2)');
  });

  it('a Date is bound through the column, not interpolated', () => {
    const at = new Date('2026-06-01T00:00:00.000Z');
    const rendered = render({ startsAt: { $gte: at } });
    expect(rendered?.sql).toBe('"things"."starts_at" >= $1');
    expect(rendered?.params).toEqual(['2026-06-01T00:00:00.000Z']);
  });

  it('$in binds each value', () => {
    expect(render({ teamId: { $in: ['a', 'b'] } })).toEqual({
      sql: '"things"."team_id" in ($1, $2)',
      params: ['a', 'b'],
    });
  });

  it('$in over an empty list matches nothing rather than emitting invalid SQL', () => {
    expect(render({ teamId: { $in: [] } })).toEqual({ sql: 'false', params: [] });
  });

  it('$nin over an empty list matches everything', () => {
    expect(render({ teamId: { $nin: [] } })).toEqual({ sql: 'true', params: [] });
  });
});

describe('toSqlWhere: null handling matches the in-memory matcher', () => {
  it('equality with null is IS NULL', () => {
    expect(render({ teamId: null })?.sql).toBe('"things"."team_id" is null');
    expect(render({ teamId: { $eq: null } })?.sql).toBe('"things"."team_id" is null');
  });

  it('$ne null is IS NOT NULL', () => {
    expect(render({ teamId: { $ne: null } })?.sql).toBe('"things"."team_id" is not null');
  });

  it('$ne treats a null column as different, as CASL does in memory', () => {
    expect(render({ teamId: { $ne: 'a' } })?.sql).toBe('"things"."team_id" is distinct from $1');
    const ability = createMongoAbility([{ action: 'read', subject: 'things', conditions: { teamId: { $ne: 'a' } } }]);
    expect(ability.can('read', subject('things', { teamId: null }))).toBe(true);
  });

  it('$nin admits a null column, as CASL does in memory', () => {
    expect(render({ teamId: { $nin: ['a'] } })?.sql).toBe(
      '("things"."team_id" is null or "things"."team_id" not in ($1))',
    );
    const ability = createMongoAbility([{ action: 'read', subject: 'things', conditions: { teamId: { $nin: ['a'] } } }]);
    expect(ability.can('read', subject('things', { teamId: null }))).toBe(true);
  });

  it('ordering admits a null column exactly where CASL does in memory', () => {
    expect(render({ rank: { $lt: 5 } })?.sql).toBe('("things"."rank" is null or "things"."rank" < $1)');
    expect(render({ rank: { $lte: 5 } })?.sql).toBe('("things"."rank" is null or "things"."rank" <= $1)');
    expect(render({ rank: { $gt: 5 } })?.sql).toBe('"things"."rank" > $1');
    expect(render({ rank: { $gte: 5 } })?.sql).toBe('"things"."rank" >= $1');

    // Both directions, over every operand kind: CASL coerces null to 0, so the answer
    // flips for a negative number or a pre-1970 date. SQL must flip with it.
    const operands: [keyof typeof columns, string | number | Date][] = [
      ['rank', 5],
      ['rank', 0],
      ['rank', -1],
      ['teamId', 'm'],
      ['teamId', ''],
      ['teamId', '-5'],
      ['startsAt', new Date('2026-06-01T00:00:00Z')],
      ['startsAt', new Date(0)],
      ['startsAt', new Date('1960-01-01T00:00:00Z')],
    ];
    for (const [field, operand] of operands) {
      for (const operator of ['$gt', '$gte', '$lt', '$lte']) {
        const conditions = { [field]: { [operator]: operand } };
        const ability = createMongoAbility([{ action: 'read', subject: 'things', conditions }]);
        const inMemory = ability.can('read', subject('things', { [field]: null }));
        const inSql = render(conditions)?.sql.includes(' is null or ') ?? false;
        expect(inSql, `${field} ${operator} ${String(operand)}`).toBe(inMemory);
      }
    }
  });

  it('ordering against null is refused', () => {
    expect(() => render({ rank: { $gt: null } })).toThrow(/requires a scalar value/);
  });

  it('ordering against a boolean is refused, as CASL refuses it in memory', () => {
    expect(() => render({ rank: { $gt: true } })).toThrow(/cannot order against a boolean/);
    expect(() => render({ rank: { $lte: false } })).toThrow(/cannot order against a boolean/);
    const ability = createMongoAbility([{ action: 'read', subject: 'things', conditions: { rank: { $gt: true } } }]);
    expect(() => ability.can('read', subject('things', { rank: 1 }))).toThrow();
  });
});

describe('toSqlWhere: logical operators', () => {
  it('$and', () => {
    expect(render({ $and: [{ id: 'a' }, { rank: 1 }] })?.sql).toBe(
      '("things"."id" = $1 and "things"."rank" = $2)',
    );
  });

  it('$or', () => {
    expect(render({ $or: [{ id: 'a' }, { rank: 1 }] })?.sql).toBe(
      '("things"."id" = $1 or "things"."rank" = $2)',
    );
  });

  it('$not counts an unknown (NULL) inner result as not matching', () => {
    expect(render({ $not: { rank: { $gt: 1 } } })?.sql).toBe('("things"."rank" > $1) is not true');
  });

  it('nests', () => {
    expect(
      render({ teamId: { $in: ['a'] }, $or: [{ rank: 1 }, { $and: [{ rank: { $gt: 5 } }, { id: 'x' }] }] }),
    ).toEqual({
      sql: '("things"."team_id" in ($1) and ("things"."rank" = $2 or ("things"."rank" > $3 and "things"."id" = $4)))',
      params: ['a', 1, 5, 'x'],
    });
  });

  it('an unrestricted member makes an $or unrestricted, and drops out of an $and', () => {
    expect(render({ $or: [{ id: 'a' }, {}] })).toBeUndefined();
    expect(render({ $and: [{ id: 'a' }, {}] })?.sql).toBe('"things"."id" = $1');
  });

  it('$not of no restriction matches nothing', () => {
    expect(render({ $not: {} })?.sql).toBe('false');
  });
});

describe('toSqlWhere: fails loud', () => {
  it('throws on an unknown field operator', () => {
    expect(() => render({ id: { $regex: '^a' } })).toThrow(/Unsupported operator "\$regex" on "id"/);
  });

  it('throws on an unknown logical operator', () => {
    expect(() => render({ $nor: [{ id: 'a' }] })).toThrow(/Unsupported logical operator "\$nor"/);
  });

  it('throws on a field that is not a mapped column -- including a relation', () => {
    expect(() => render({ team: { coachUserId: 'u' } })).toThrow(/"team", which is not a mapped column/);
    expect(() => render({ constructor: 'x' })).toThrow(/not a mapped column/);
  });

  it('throws on malformed operands', () => {
    expect(() => render({ teamId: { $in: 'a' } })).toThrow(/\$in on "teamId" requires an array/);
    expect(() => render({ teamId: { $in: [['a']] } })).toThrow(/requires a scalar value/);
    expect(() => render({ $and: [] })).toThrow(/non-empty array/);
    expect(() => render({ $or: 'x' })).toThrow(/non-empty array/);
    expect(() => render({ id: {} })).toThrow(/empty object/);
    expect(() => render({ id: undefined })).toThrow(/requires a scalar value/);
  });

  it('throws when the condition is not an object', () => {
    expect(() => render(null)).toThrow(/plain object/);
    expect(() => render([{ id: 'a' }])).toThrow(/plain object/);
  });
});
