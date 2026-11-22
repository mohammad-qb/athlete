import { ApiErrorType } from '../api.error';

/**
 * Framework status code -> `ApiErrorType`, so `type` stays a usable switch for clients
 * even when the failure came from machinery this codebase did not write: the router's
 * own 404 for an unknown path, a guard rejection, body-parser refusing an oversized
 * payload.
 */
const TYPE_BY_STATUS: Record<number, ApiErrorType> = {
  400: ApiErrorType.BAD_REQUEST,
  401: ApiErrorType.UNAUTHORIZED,
  403: ApiErrorType.FORBIDDEN,
  404: ApiErrorType.NOT_FOUND,
  409: ApiErrorType.CONFLICT,
  429: ApiErrorType.RATE_LIMIT,
  504: ApiErrorType.TIMEOUT,
};

/**
 * Closest type for a framework status. An unmapped status falls back by class, and the
 * original status code is preserved by the caller either way -- the mapping chooses a
 * label, never a status.
 */
export function resolveApiErrorType(statusCode: number): ApiErrorType {
  return (
    TYPE_BY_STATUS[statusCode] ??
    (statusCode >= 500 ? ApiErrorType.INTERNAL : ApiErrorType.BAD_REQUEST)
  );
}
