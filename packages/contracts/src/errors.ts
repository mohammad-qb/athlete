import { z } from 'zod';

/**
 * The category of a failure: the value a client switches on. The API's error class
 * (`apps/api/src/common/errors/api.error.ts`) is tied to this list by type, so neither
 * side can gain a category the other does not know.
 */
export const ErrorType = z
  .enum([
    'VALIDATION',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
    'RATE_LIMIT',
    'BAD_REQUEST',
    'INTERNAL',
    'DATABASE',
    'TIMEOUT',
    'UNKNOWN',
  ])
  .meta({ id: 'ErrorType' });
export type ErrorType = z.infer<typeof ErrorType>;

/**
 * The body of EVERY failed request, whatever failed and wherever: one shape, so a
 * client writes one error handler.
 *
 * `code` is the stable identifier of a specific failure (`stale_write`,
 * `validation_failed`, `invalid_origin`) for a client that branches on more than
 * `type`. `meta` is machine-readable detail whose shape depends on `code`; for
 * `validation_failed` it is `ValidationErrorMeta`.
 */
export const ErrorResponse = z
  .object({
    statusCode: z.number().int(),
    name: z.string(),
    message: z.string(),
    type: ErrorType,
    code: z.string().optional(),
    explanation: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** One invalid field of a request, as `meta.fields` of a `validation_failed` lists it. */
export const FieldError = z
  .object({
    /** Which part of the request the field is in. */
    in: z.enum(['params', 'query', 'body']),
    /** Dot path from the root of that part; empty when the part itself is wrong. */
    path: z.string(),
    messages: z.array(z.string()),
  })
  .meta({ id: 'FieldError' });
export type FieldError = z.infer<typeof FieldError>;

/** `meta` of an error whose `code` is `validation_failed`. */
export const ValidationErrorMeta = z
  .object({ fields: z.array(FieldError) })
  .meta({ id: 'ValidationErrorMeta' });
export type ValidationErrorMeta = z.infer<typeof ValidationErrorMeta>;
