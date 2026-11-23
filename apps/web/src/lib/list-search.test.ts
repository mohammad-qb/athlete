import { AthleteListQuery } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { listSearch } from './list-search';

const search = listSearch(AthleteListQuery);

describe('listSearch', () => {
  it('reads list state from the URL as the API would, coercing numbers', () => {
    expect(search.parse({ page: '3', pageSize: '50', sort: '-createdAt', q: ' fal ' })).toEqual({
      page: 3,
      pageSize: 50,
      sort: '-createdAt',
      q: 'fal',
    });
  });

  it('fills in the contract defaults for an address with no search', () => {
    expect(search.parse({})).toEqual({ page: 1, pageSize: 25, sort: 'lastName' });
  });

  it.each([
    ['a key that is not sortable', { sort: 'passwordHash' }],
    ['a page size above the limit', { pageSize: '5000' }],
    ['a page that is not a number', { page: 'two' }],
    ['a parameter the contract does not have', { admin: 'true' }],
  ])('falls back to the defaults for %s, instead of an error page', (_label, raw) => {
    expect(search.parse(raw)).toEqual({ page: 1, pageSize: 25, sort: 'lastName' });
  });
});
