import { createAuthClient } from 'better-auth/react';

/**
 * better-auth's browser client, for the three things a person does to their own
 * session: sign in, sign out, change password. Everything else about identity (who is
 * signed in, which academy, which permissions) comes from `GET /api/v1/me`, not from here.
 *
 * Same origin as the page, so the session cookie is first-party, httpOnly and never
 * visible to this code. There is no token to store.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/** What a failed call to better-auth looks like to a form. */
export interface AuthFailure {
  status: number;
  code: string | undefined;
  message: string;
}

/** The error half of what a better-auth call resolves with. */
interface AuthError {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
}

function toAuthFailure(error: AuthError): AuthFailure {
  return {
    status: error.status,
    code: error.code,
    message: error.message ?? 'Something went wrong. Try again.',
  };
}

/**
 * How a better-auth call failed, or `null` when it did not.
 *
 * better-auth resolves with `{ error }` when the server refuses, but REJECTS when no
 * response arrives at all (offline, the API is down). Both end here as an
 * `AuthFailure`, the second with status 0 like `ApiError`, so a caller has one thing
 * to check and nothing to catch.
 */
export async function authFailureOf(
  call: Promise<{ error: AuthError | null }>,
): Promise<AuthFailure | null> {
  try {
    const { error } = await call;
    return error ? toAuthFailure(error) : null;
  } catch {
    return {
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
}
