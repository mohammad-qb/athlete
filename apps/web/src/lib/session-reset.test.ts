import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { DRAFT_KEY_PREFIX, resetSession } from './session-reset';

describe('resetSession', () => {
  it('drops every cached API answer', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['athletes'], { items: [{ id: 'a' }] });
    queryClient.setQueryData(['me'], { user: { id: 'u' } });

    resetSession(queryClient);

    expect(queryClient.getQueryData(['athletes'])).toBeUndefined();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('can keep one query, for the shell that stays mounted across an academy switch', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['athletes', { page: 1 }], { items: [{ id: 'a' }] });
    queryClient.setQueryData([{ _id: 'meRead' }], { activeAcademyId: 'alpha' });

    resetSession(queryClient, { keep: [{ _id: 'meRead' }] });

    expect(queryClient.getQueryData(['athletes', { page: 1 }])).toBeUndefined();
    expect(queryClient.getQueryData([{ _id: 'meRead' }])).toEqual({ activeAcademyId: 'alpha' });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it('deletes every local draft and nothing else in local storage', () => {
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}user-1:academy-1:session-1`, '{"a":1}');
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}user-1:academy-1:session-2`, '{"b":2}');
    window.localStorage.setItem('sidebar_state', 'true');

    resetSession(new QueryClient());

    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem('sidebar_state')).toBe('true');
  });

  it('still clears the cache when local storage is unavailable', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['athletes'], { items: [] });
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    window.localStorage.setItem(`${DRAFT_KEY_PREFIX}x`, '1');

    expect(() => resetSession(queryClient)).not.toThrow();
    expect(queryClient.getQueryData(['athletes'])).toBeUndefined();
  });
});
