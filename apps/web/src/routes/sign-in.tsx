import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInPage } from '@/features/auth';
import { resetSession } from '@/lib/session-reset';

const SignInSearch = z.object({
  /** Where the person was going when they were sent here. */
  redirect: z.string().optional().catch(undefined),
});

/** Only a path on this origin: `//host` and `https://host` are someone else's page. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
    ? target
    : '/';
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: SignInSearch,
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <SignInPage
      onSignedIn={() => {
        // Nothing cached before this moment was fetched as the person who just signed in.
        resetSession(queryClient);
        router.history.push(safeRedirect(redirect));
      }}
    />
  );
}
