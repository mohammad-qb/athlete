import type { ErrorResponse, ErrorType, FieldError } from '@athlete/contracts';
import { client } from './generated/client.gen';

/**
 * The ONE error every failed API call becomes, whatever failed: a refusal the API
 * typed (`ErrorResponse`), a body that is not the API's (a proxy's HTML 502), or no
 * response at all (offline). Screens never look at a raw response; they hand this to
 * the error mapper in `./errors`.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status; 0 when no response arrived. */
  readonly status: number;
  readonly type: ErrorType;
  /** The stable identifier of the specific failure (`stale_write`, `validation_failed`). */
  readonly code: string | undefined;
  /** The invalid fields of a `validation_failed`; empty for anything else. */
  readonly fields: readonly FieldError[];
  readonly meta: Readonly<Record<string, unknown>>;

  constructor(init: {
    status: number;
    type: ErrorType;
    message: string;
    code?: string | undefined;
    fields?: readonly FieldError[];
    meta?: Record<string, unknown>;
  }) {
    super(init.message);
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
    this.fields = init.fields ?? [];
    this.meta = init.meta ?? {};
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as ErrorResponse).message === 'string' &&
    typeof (body as ErrorResponse).type === 'string'
  );
}

function fieldsOf(meta: Record<string, unknown> | undefined): FieldError[] {
  const fields = meta?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (field): field is FieldError =>
      typeof field === 'object' &&
      field !== null &&
      typeof (field as FieldError).path === 'string' &&
      Array.isArray((field as FieldError).messages),
  );
}

/** Any thrown value or error body, with the response it came with (if one came), as an `ApiError`. */
export function toApiError(error: unknown, response?: Response): ApiError {
  if (error instanceof ApiError) return error;
  if (isErrorResponse(error)) {
    return new ApiError({
      status: response?.status ?? error.statusCode,
      type: error.type,
      message: error.message,
      code: error.code,
      fields: fieldsOf(error.meta),
      ...(error.meta ? { meta: error.meta } : {}),
    });
  }
  if (response) {
    // A status without the API's body: something between the browser and the API answered.
    return new ApiError({
      status: response.status,
      type: 'UNKNOWN',
      message: `The server answered ${response.status}.`,
    });
  }
  return new ApiError({
    status: 0,
    type: 'UNKNOWN',
    code: 'network_error',
    message: 'Could not reach the server. Check your connection and try again.',
  });
}

/**
 * Configures the generated client, once, at import.
 *
 * No base URL: the SPA and the API share an origin (the Vite proxy in development,
 * Front Door in production), so paths are relative and the session cookie is
 * first-party. `same-origin` says so explicitly: the cookie is never sent anywhere else.
 */
client.setConfig({ credentials: 'same-origin' });
client.interceptors.error.use((error, response) => toApiError(error, response));

export { client };
