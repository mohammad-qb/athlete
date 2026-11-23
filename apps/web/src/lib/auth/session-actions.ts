import type { QueryClient } from '@tanstack/react-query';
import { ApiError, meReadOptions, meSwitchAcademy, type MeResponse } from '../api';
import { resetSession } from '../session-reset';
import { authClient, authFailureOf } from './auth-client';

/**
 * Ends the session on the server. The caller then leaves the signed-in screens and
 * calls `resetSession`, in that order: clearing the cache under a mounted screen would
 * make it refetch as nobody.
 *
 * Throws when the server did not confirm it (a 5xx, a 429, no response): the cookie
 * and the session are then still valid, and a caller that went on to the sign-in page
 * would only look signed out. The error is an `ApiError`, for the error mapper.
 */
export async function signOut(): Promise<void> {
  const failure = await authFailureOf(authClient.signOut());
  if (failure) {
    throw new ApiError({
      status: failure.status,
      type: 'UNKNOWN',
      code: failure.code,
      message: failure.message,
    });
  }
}

/**
 * Acts in another academy the user belongs to.
 *
 * The server moves the session; this browser then forgets everything it fetched in the
 * previous academy (cache and drafts) before anything is drawn, keeping only `/me`,
 * which it replaces with the answer the switch returned.
 */
export async function switchAcademy(
  queryClient: QueryClient,
  academyId: string,
): Promise<MeResponse> {
  const { data } = await meSwitchAcademy({ body: { academyId }, throwOnError: true });
  const meKey = meReadOptions().queryKey;
  resetSession(queryClient, { keep: meKey });
  // Written last: this is what notifies the mounted shell, which then remounts the
  // page for the new academy over an already-empty cache.
  queryClient.setQueryData(meKey, data);
  return data;
}
