import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { clearDrafts } from './drafts';

/**
 * Forgets everything this browser holds about the signed-in person and their academy:
 * every cached API answer and every local draft (`./drafts`).
 *
 * Called on sign-out, on an academy switch and on a 401. All three mean "what is cached
 * was fetched as someone, or somewhere, else": showing it for even one frame would put
 * one tenant's rows on another tenant's screen.
 *
 * `keep` names the one query that survives, for the academy switch: the shell stays
 * mounted across it and reads `/me`, so that query is kept and then overwritten with
 * the new answer (which is what tells the shell to redraw). Removing it instead would
 * leave the mounted shell holding the previous academy until something re-rendered it.
 */
export function resetSession(queryClient: QueryClient, options: { keep?: QueryKey } = {}): void {
  if (options.keep) {
    const kept = hashKey(options.keep);
    queryClient.removeQueries({ predicate: (query) => query.queryHash !== kept });
    queryClient.getMutationCache().clear();
  } else {
    queryClient.clear();
  }
  clearDrafts();
}
