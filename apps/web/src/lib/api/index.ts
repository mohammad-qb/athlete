/**
 * The API as the rest of the app sees it: the configured client, the one error class,
 * the error mapper, and everything generated from `apps/api/openapi.json`.
 *
 * Importing from here (never from `./generated/...` directly) is what guarantees the
 * client has been configured before the first request.
 */
export { ApiError, client, isApiError, toApiError } from './client';
export {
  configureErrorMapper,
  handleApiError,
  type ErrorHandlers,
  type ErrorOutcome,
  type FieldErrors,
} from './errors';
export * from './generated';
export * from './generated/@tanstack/react-query.gen';
