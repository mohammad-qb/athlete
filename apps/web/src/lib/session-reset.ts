import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Every draft kept in local storage lives under this prefix (the attendance register's
 * drafts arrive in phase 5), so "all drafts" is a definition and not a list to maintain.
 */
export const DRAFT_KEY_PREFIX = 'athlete:draft:';

/**
 * Forgets everything this browser holds about the signed-in person and their academy:
 * every cached API answer and every local draft.
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

function clearDrafts(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, a blocked cookie jar). There is then
    // no draft to clear, and a reset must never fail on its way to sign-in.
  }
}
