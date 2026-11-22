import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { isApiError, meRead, meReadOptions, type MeResponse } from '@/lib/api';

/**
 * Everything behind sign-in. `beforeLoad` is the guard: it loads `GET /me` (who, which
 * academy, which permissions) before any child route runs, or sends the visitor to
 * sign-in remembering where they were going.
 *
 * The answer is put in the query cache, which is where `useMe()` and `<Can>` read it.
 * This is a convenience for the person, not a control: the API authorizes every
 * request by itself, whatever this browser believes.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }): Promise<{ me: MeResponse }> => {
    const cached = context.queryClient.getQueryData(meReadOptions().queryKey);
    if (cached) return { me: cached };
    try {
      const { data } = await meRead({ throwOnError: true });
      context.queryClient.setQueryData(meReadOptions().queryKey, data);
      return { me: data };
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
