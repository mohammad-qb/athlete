/**
 * The error taxonomy.
 *
 * One class carries the whole wire contract: the category a client can switch on, the
 * HTTP status, the severity it is logged at, and the machine-readable detail. Anything
 * thrown anywhere in the application is normalised to this shape by exactly one
 * responder (see error-responder.ts), so there is a single place where a failure
 * becomes a response and a single place where it becomes a log line.
 *
 * The alternative -- Nest's `HttpException` subclasses thrown ad hoc, each route
 * inventing its own body -- is what this replaces. Two endpoints in this repository
 * already disagreed about error bodies (`{ error, message }` for a conflict,
 * `{ error, issues }` for validation, a bare string from the framework's own 404), so
 * a client could not write one error handler.
 */

import type { ErrorResponse, ErrorType } from '@athlete/contracts';

/** Severity the responder logs at. Mapped from status unless stated explicitly. */
export type ApiErrorLogLevel = 'error' | 'warn' | 'info' | 'debug';

export const ApiErrorType = {
  VALIDATION: 'VALIDATION',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT: 'RATE_LIMIT',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL',
  DATABASE: 'DATABASE',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
  // Tied to the contracts enum both ways: a category missing here, or one the published
  // contract does not list, is a compile error rather than a body a client cannot type.
} as const satisfies { [Type in ErrorType]: Type };
export type ApiErrorType = (typeof ApiErrorType)[keyof typeof ApiErrorType];

/**
 * `type` -> default HTTP status.
 *
 * UNKNOWN maps to **500**, and that is the one entry worth defending. The obvious
 * alternative -- and the choice made by the reference implementation this taxonomy is
 * adapted from -- is 400. It is wrong twice over: an error nobody classified is by
 * definition not known to be the caller's fault, so reporting it as one is a lie to the
 * client; and because `logLevel` is derived from status, a 400 is logged at `warn`,
 * which keeps every unclassified server fault out of error-level alerting entirely.
 * The failure mode is a service that is broken and quiet. Defaulting to 500 means an
 * unclassified error is loud and, if it really was the client's mistake, someone has to
 * classify it properly to make it a 400.
 */
const STATUS_BY_TYPE: Record<ApiErrorType, number> = {
  [ApiErrorType.VALIDATION]: 400,
  [ApiErrorType.BAD_REQUEST]: 400,
  [ApiErrorType.UNAUTHORIZED]: 401,
  [ApiErrorType.FORBIDDEN]: 403,
  [ApiErrorType.NOT_FOUND]: 404,
  [ApiErrorType.CONFLICT]: 409,
  [ApiErrorType.RATE_LIMIT]: 429,
  [ApiErrorType.INTERNAL]: 500,
  [ApiErrorType.DATABASE]: 500,
  [ApiErrorType.TIMEOUT]: 504,
  [ApiErrorType.UNKNOWN]: 500,
};

export interface ApiErrorOptions {
  type?: ApiErrorType;
  /** Overrides the type's default. Needed only for a status the taxonomy has no type for. */
  statusCode?: number;
  /** Stable identifier for a specific failure, for clients that branch on more than `type`. */
  code?: string;
  /** Machine-readable detail: the field that failed, the version expected. Never prose. */
  meta?: Record<string, unknown>;
  /** What the caller can do about it, in a sentence. Prose, for a human. */
  explanation?: string;
  /** The underlying failure. Reaches the log; never the wire. */
  cause?: Error;
  logLevel?: ApiErrorLogLevel;
}

/**
 * The response body, verbatim. `cause` is deliberately absent: a causal chain carries
 * driver messages, SQL and connection strings, and belongs in logs only. Because it is
 * impossible to serialise, a caller can always attach the real error without having to
 * reason about whether it leaks.
 *
 * The shape is the contract's (`ErrorResponse` in `packages/contracts`), which is also
 * what the OpenAPI document publishes for every error status.
 */
export type ApiErrorResponse = ErrorResponse;

export class ApiError extends Error {
  readonly type: ApiErrorType;
  readonly statusCode: number;
  readonly code?: string;
  readonly meta?: Record<string, unknown>;
  readonly explanation?: string;
  override readonly cause?: Error;
  readonly logLevel: ApiErrorLogLevel;

  /** A subclass overrides this, so logs and bodies name the specific error. */
  override readonly name: string = 'ApiError';

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause });

    this.type = options.type ?? ApiErrorType.UNKNOWN;
    this.statusCode = options.statusCode ?? STATUS_BY_TYPE[this.type];
    this.code = options.code;
    this.meta = options.meta;
    this.explanation = options.explanation;
    this.cause = options.cause;
    this.logLevel = options.logLevel ?? defaultLogLevel(this.statusCode);

    // Keeps the stack pointing at the throw site rather than at this constructor.
    Error.captureStackTrace?.(this, ApiError);
  }

  toJSON(): ApiErrorResponse {
    return {
      statusCode: this.statusCode,
      name: this.name,
      message: this.message,
      type: this.type,
      code: this.code,
      explanation: this.explanation,
      meta: this.meta,
    };
  }
}

/**
 * A 5xx is a fault on this side and should page someone. A 4xx is the protocol working
 * as designed -- a stale write, a missing field -- and logging it at error level trains
 * everyone to ignore error level.
 */
function defaultLogLevel(statusCode: number): ApiErrorLogLevel {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}
