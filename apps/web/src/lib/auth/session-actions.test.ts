import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { signOut } from './session-actions';

const authSignOut = vi.hoisted(() => vi.fn());
vi.mock('./auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth-client')>()),
  authClient: { signOut: authSignOut },
}));

describe('signOut', () => {
  beforeEach(() => {
    authSignOut.mockReset();
  });

  it('resolves once the server has ended the session', async () => {
    authSignOut.mockResolvedValue({ data: { success: true }, error: null });
    await expect(signOut()).resolves.toBeUndefined();
  });

  it('throws when the server refuses, so the caller does not leave a live session behind', async () => {
    authSignOut.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error', message: 'boom' },
    });
    const error: unknown = await signOut().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: 'boom' });
  });

  it('throws when no response arrives', async () => {
    authSignOut.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(signOut()).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      code: 'network_error',
    });
  });
});
