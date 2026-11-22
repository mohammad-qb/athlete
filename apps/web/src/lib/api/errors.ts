import { toast } from 'sonner';
import { type ApiError, toApiError } from './client';

/** Messages per form field, keyed by the field's dot path in the request body. */
export type FieldErrors = Record<string, string[]>;

/** What a caller can do with an error that the mapper cannot do by itself. */
export interface ErrorHandlers {
  /** A form: receives the server's validation messages for its fields. */
  setFieldErrors?: (fields: FieldErrors) => void;
  /** An edit form: called on a 409 `stale_write`, to open the conflict dialog. */
  onConflict?: (error: ApiError) => void;
}

/** What the mapper did with an error. Returned so a caller (and a test) can tell. */
export type ErrorOutcome = 'fields' | 'conflict' | 'unauthorized' | 'toast';

let onUnauthorized: () => void = () => {};

/**
 * Wired once at start-up (`src/main.tsx`): what "the session is gone" means for the
 * running app -- drop every cached answer and go to sign-in. It is injected because
 * `lib` may not import the router (`routes` and `features` sit above it).
 */
export function configureErrorMapper(options: { onUnauthorized: () => void }): void {
  onUnauthorized = options.onUnauthorized;
}

const MESSAGES = {
  forbidden: 'You do not have permission to do that.',
  notFound: 'That record no longer exists, or you do not have access to it.',
  conflict: 'Someone else changed this record. Reload to see their changes.',
  rateLimited: 'Too many requests. Wait a moment and try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
} as const;

/**
 * THE error mapper: every failed API call in the app ends here, and nothing else
 * decides what a failure looks like. Screens do not parse errors.
 *
 *   validation_failed + a form  -> the messages go to the matching fields
 *   409 stale_write + an editor -> the conflict handler (the shared dialog)
 *   401                         -> state cleared, redirect to sign-in
 *   403, 404, 429, 5xx          -> one consistent toast each
 *   anything else               -> a toast with the server's own message
 */
export function handleApiError(error: unknown, handlers: ErrorHandlers = {}): ErrorOutcome {
  const apiError = toApiError(error);

  if (apiError.status === 401) {
    onUnauthorized();
    return 'unauthorized';
  }

  if (apiError.type === 'VALIDATION' && handlers.setFieldErrors) {
    const fields: FieldErrors = {};
    for (const field of apiError.fields) {
      // Only the body is a form's business. A bad path or query parameter is a defect
      // in this app, not something the person typing can fix in a field.
      if (field.in !== 'body' || field.path === '') continue;
      fields[field.path] = [...(fields[field.path] ?? []), ...field.messages];
    }
    if (Object.keys(fields).length > 0) {
      handlers.setFieldErrors(fields);
      return 'fields';
    }
  }

  if (apiError.status === 409 && apiError.code === 'stale_write') {
    if (handlers.onConflict) {
      handlers.onConflict(apiError);
      return 'conflict';
    }
    toast.error(MESSAGES.conflict);
    return 'toast';
  }

  if (apiError.status === 403) toast.error(MESSAGES.forbidden);
  else if (apiError.status === 404) toast.error(MESSAGES.notFound);
  else if (apiError.status === 429) toast.error(MESSAGES.rateLimited);
  else if (apiError.status >= 500) toast.error(MESSAGES.server);
  // Unknown codes, and no response at all: the message already says what happened.
  else toast.error(apiError.message);
  return 'toast';
}
