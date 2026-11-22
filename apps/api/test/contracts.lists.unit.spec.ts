import {
  AthleteListQuery,
  AthletePage,
  listQueryOf,
  pageOf,
  parseSort,
  SessionListQuery,
  TeamListQuery,
} from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { containsPattern, pageWindow } from '../src/common/db/listing';

/**
 * PROVES: the list contract turns a query string into a bounded, typed page request,
 * and refuses what it does not understand instead of ignoring it.
 *
 * A query string carries only text, so every value here arrives as a string -- which
 * is how the cases below are written.
 */
describe('listQueryOf', () => {
  const Query = listQueryOf(['name', 'createdAt'], '-createdAt');
  const issuesOf = (input: unknown) =>
    Query.safeParse(input).error?.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`);

  it('applies its defaults to an empty query', () => {
    expect(Query.parse({})).toEqual({ page: 1, pageSize: 25, sort: '-createdAt' });
  });

  it('coerces numbers from the strings a query string carries', () => {
    expect(Query.parse({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
  });

  it.each([
    ['page below 1', { page: '0' }],
    ['a negative page', { page: '-1' }],
    ['a fractional page', { page: '1.5' }],
    ['a page that is not a number', { page: 'two' }],
    ['an empty page', { page: '' }],
    ['pageSize below 1', { pageSize: '0' }],
    ['pageSize above 100', { pageSize: '101' }],
    ['a pageSize that is not a number', { pageSize: 'all' }],
  ])('refuses %s', (_label, input) => {
    expect(Query.safeParse(input).success).toBe(false);
  });

  it('accepts the bounds themselves', () => {
    expect(Query.parse({ page: '1', pageSize: '1' })).toMatchObject({ page: 1, pageSize: 1 });
    expect(Query.parse({ pageSize: '100' }).pageSize).toBe(100);
  });

  it('accepts each sortable key, ascending or descending behind a "-"', () => {
    for (const sort of ['name', '-name', 'createdAt', '-createdAt']) {
      expect(Query.parse({ sort }).sort).toBe(sort);
    }
  });

  it.each(['id', 'passwordHash', '+name', '--name', 'name,createdAt', 'NAME', ''])(
    'refuses sort=%s: only a listed key ever reaches an ORDER BY',
    (sort) => {
      expect(issuesOf({ sort })).toEqual(['sort:invalid_value']);
    },
  );

  it('trims q and bounds its length', () => {
    expect(Query.parse({ q: '  falcon  ' }).q).toBe('falcon');
    expect(Query.parse({ q: 'x'.repeat(100) }).q).toHaveLength(100);
    expect(Query.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('leaves q out when it is not sent', () => {
    expect(Query.parse({})).not.toHaveProperty('q');
  });

  it('refuses a parameter it does not know instead of ignoring it', () => {
    expect(issuesOf({ limit: '10' })).toEqual([':unrecognized_keys']);
    expect(issuesOf({ offset: '20', page: '1' })).toEqual([':unrecognized_keys']);
  });

  it('reports every bad parameter at once', () => {
    expect(issuesOf({ page: '0', pageSize: '500', sort: 'nope' })?.sort()).toEqual([
      'page:too_small',
      'pageSize:too_big',
      'sort:invalid_value',
    ]);
  });
});

describe('the list queries the routes declare', () => {
  it('athletes: sorted by last name by default, on the four agreed keys', () => {
    expect(AthleteListQuery.parse({}).sort).toBe('lastName');
    for (const key of ['lastName', 'firstName', 'dateOfBirth', 'createdAt']) {
      expect(AthleteListQuery.safeParse({ sort: `-${key}` }).success).toBe(true);
    }
    expect(AthleteListQuery.safeParse({ sort: 'academyId' }).success).toBe(false);
  });

  it('teams: sorted by name', () => {
    expect(TeamListQuery.parse({})).toEqual({ page: 1, pageSize: 25, sort: 'name' });
    expect(TeamListQuery.safeParse({ sort: 'sport' }).success).toBe(false);
  });

  it('sessions: newest first, filtered by team and by a period', () => {
    const team = '66666666-6666-6666-6666-666666666666';
    expect(SessionListQuery.parse({})).toEqual({ page: 1, pageSize: 25, sort: '-startsAt' });
    expect(
      SessionListQuery.parse({ teamId: team, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }),
    ).toMatchObject({ teamId: team, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
  });

  it('sessions: a bare date is not an instant, and a team id must be one', () => {
    expect(SessionListQuery.safeParse({ from: '2026-01-01' }).success).toBe(false);
    expect(SessionListQuery.safeParse({ teamId: 'team-a' }).success).toBe(false);
  });

  it('sessions: there is nothing to search, so q is refused rather than accepted and ignored', () => {
    const result = SessionListQuery.safeParse({ q: 'pitch' });
    expect(result.error?.issues.map((issue) => issue.code)).toEqual(['unrecognized_keys']);
  });
});

describe('parseSort', () => {
  it('splits the direction from the key', () => {
    expect(parseSort('lastName')).toEqual({ key: 'lastName', descending: false });
    expect(parseSort('-createdAt')).toEqual({ key: 'createdAt', descending: true });
  });
});

describe('pageOf', () => {
  const Page = pageOf(z.object({ id: z.string() }));

  it('describes { items, total, page, pageSize }', () => {
    const page = { items: [{ id: 'a' }], total: 41, page: 2, pageSize: 25 };
    expect(Page.parse(page)).toEqual(page);
  });

  it('strips what an item does not declare, like any response schema', () => {
    const parsed = Page.parse({ items: [{ id: 'a', secret: 1 }], total: 1, page: 1, pageSize: 25 });
    expect(parsed.items).toEqual([{ id: 'a' }]);
  });

  it.each([
    ['a missing total', { items: [], page: 1, pageSize: 25 }],
    ['a negative total', { items: [], total: -1, page: 1, pageSize: 25 }],
    ['page 0', { items: [], total: 0, page: 0, pageSize: 25 }],
    ['items that are not a list', { items: {}, total: 0, page: 1, pageSize: 25 }],
  ])('refuses %s', (_label, value) => {
    expect(Page.safeParse(value).success).toBe(false);
  });

  it('is what the athletes list answers with', () => {
    expect(AthletePage.safeParse({ items: [], total: 0, page: 1, pageSize: 25 }).success).toBe(true);
  });
});

describe('list SQL helpers', () => {
  it('pageWindow turns a 1-based page into LIMIT and OFFSET', () => {
    expect(pageWindow({ page: 1, pageSize: 25 })).toEqual({ limit: 25, offset: 0 });
    expect(pageWindow({ page: 3, pageSize: 10 })).toEqual({ limit: 10, offset: 20 });
  });

  it('containsPattern matches q anywhere and takes its wildcards literally', () => {
    expect(containsPattern('ali')).toBe('%ali%');
    // Unescaped, "%" would match every row and "_" any single character.
    expect(containsPattern('50%')).toBe('%50\\%%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('back\\slash')).toBe('%back\\\\slash%');
  });
});
