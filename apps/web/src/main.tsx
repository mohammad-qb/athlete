import '@fontsource-variable/geist';
import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureErrorMapper } from '@/lib/api';
import { createQueryClient } from '@/lib/query-client';
import { resetSession } from '@/lib/session-reset';
import { createAppRouter } from './router';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

// What a 401 means for the running app, wherever it surfaces: the session is gone.
// Leave for sign-in (remembering the page), then forget everything fetched as the
// person who was signed in.
configureErrorMapper({
  onUnauthorized: () => {
    const { pathname, href } = router.state.location;
    if (pathname === '/sign-in') return;
    void router
      .navigate({ to: '/sign-in', search: { redirect: href } })
      .then(() => resetSession(queryClient));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
