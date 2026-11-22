import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { configureErrorMapper } from '@/lib/api';
import { NavUser } from './nav-user';

// Only better-auth's client is replaced: the real `signOut` and the real error mapper
// run, so this covers what a failed sign-out does to the app, end to end.
const authSignOut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/auth-client')>()),
  authClient: { signOut: authSignOut },
}));
vi.mock('@/lib/authz', () => ({
  useMe: () => ({ user: { name: 'Alpha Admin', email: 'admin@alpha.test' } }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate }),
  Link: ({ children }: { children: ReactNode }) => <a href="/account">{children}</a>,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const CACHED = ['athletes', 'list'];

function renderNavUser() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(CACHED, ['a row fetched while signed in']);
  render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <NavUser />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function chooseSignOut() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
}

describe('NavUser sign-out', () => {
  const onUnauthorized = vi.fn();

  beforeEach(() => {
    authSignOut.mockReset();
    navigate.mockReset();
    toastError.mockReset();
    onUnauthorized.mockReset();
    configureErrorMapper({ onUnauthorized });
    // jsdom has no `matchMedia`; the sidebar asks it whether the screen is a phone.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('goes to sign-in and forgets what was cached once the server has ended the session', async () => {
    authSignOut.mockResolvedValue({ data: { success: true }, error: null });
    navigate.mockResolvedValue(undefined);
    const queryClient = renderNavUser();
    await chooseSignOut();

    await waitFor(() => expect(queryClient.getQueryData(CACHED)).toBeUndefined());
    expect(navigate).toHaveBeenCalledWith({ to: '/sign-in' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays signed in and says so when the server did not end the session', async () => {
    authSignOut.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } });
    const queryClient = renderNavUser();
    await chooseSignOut();

    await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
    expect(navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(CACHED)).toBeDefined();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('stays signed in and says so when no response arrives', async () => {
    authSignOut.mockRejectedValue(new TypeError('Failed to fetch'));
    const queryClient = renderNavUser();
    await chooseSignOut();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Could not reach the server.')),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(CACHED)).toBeDefined();
  });

  it('treats a 401 as a session that is already gone: the app-wide unauthorized path, no toast', async () => {
    authSignOut.mockResolvedValue({ data: null, error: { status: 401, message: 'Unauthorized' } });
    renderNavUser();
    await chooseSignOut();

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(toastError).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
