import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/` is not a page: it sends each person to their role's landing page. For now that
 * is the athletes list for everyone; the coach's landing page arrives with sessions.
 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: () => {
    throw redirect({ to: '/athletes', replace: true });
  },
});
