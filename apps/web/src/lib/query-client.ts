import { QueryCache, QueryClient } from '@tanstack/react-query';
import { handleApiError, isApiError } from './api';

/**
 * One query client per app.
 *
 * A failed QUERY shows its error where the data would have been (the DataTable's error
 * state), so the cache does not toast -- with one exception: a 401 means the session
 * is gone, for every screen at once, and goes through the error mapper wherever it
 * surfaces. A failed MUTATION is the caller's to hand to the mapper, because only the
 * caller has the form whose fields the messages belong to.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isApiError(error) && error.status === 401) handleApiError(error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A refusal is an answer, not a blip: only a missing response or a 5xx is retried.
        retry: (failures, error) =>
          failures < 2 && !(isApiError(error) && error.status !== 0 && error.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}
