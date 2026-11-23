import { asc, desc, type AnyColumn, type SQL } from 'drizzle-orm';
import { parseSort, type SortOf } from '@athlete/contracts';

/**
 * The pieces every paginated read shares. Like `active-row.ts`, this takes columns as
 * parameters and imports nothing from the schema, so it needs no exception to the
 * `no-sql-outside-repositories` boundary rule.
 */

/**
 * ORDER BY for a `sort` value the contract has already validated against the route's
 * sortable keys. The map is the only way a key becomes a column, so there is no path
 * from a query string to an arbitrary ORDER BY.
 *
 * `tiebreak` (the primary key) is always appended. Without it, rows that compare equal
 * on the sort column have no defined order, and offset pagination over them can show a
 * row on two pages and skip another.
 */
export function orderBy<Key extends string>(
  columns: Record<Key, AnyColumn>,
  sort: SortOf<Key>,
  tiebreak: AnyColumn,
): SQL[] {
  const { key, descending } = parseSort(sort);
  const direction = descending ? desc : asc;
  return [direction(columns[key]), direction(tiebreak)];
}

/**
 * A LIKE pattern that matches `q` anywhere, with the caller's own `%`, `_` and `\`
 * taken literally: a search for "50%" must not match every row.
 */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** LIMIT and OFFSET for a 1-based page. */
export function pageWindow(query: { page: number; pageSize: number }): {
  limit: number;
  offset: number;
} {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}
