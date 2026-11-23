/**
 * The state of a server-side list, exactly as the list contract names it
 * (`listQueryOf` in `@athlete/contracts`) and exactly as it sits in the URL.
 */
export interface ListState {
  page: number;
  pageSize: number;
  /** A sortable key, ascending, or the same key behind a `-`, descending. */
  sort: string;
  q?: string | undefined;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Clicking a column: sort by it ascending, or flip the direction if it already leads. */
export function toggleSort(current: string, key: string): string {
  return current === key ? `-${key}` : key;
}

export function sortDirection(sort: string, key: string): 'asc' | 'desc' | false {
  if (sort === key) return 'asc';
  if (sort === `-${key}`) return 'desc';
  return false;
}

export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
