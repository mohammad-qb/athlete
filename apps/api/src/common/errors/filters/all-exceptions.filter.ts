import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ApiError, ApiErrorType } from '../api.error';
import { ErrorResponder } from '../error-responder';
import { resolveApiErrorType } from './status-type';

/**
 * An `http-errors`-shaped exception, matched by duck type rather than by class.
 *
 * Express middleware throws these before Nest's routing layer is involved -- most
 * visibly body-parser's `PayloadTooLargeError` (413) and raw-body aborts. Nest only
 * converts `SyntaxError` and `URIError` into `HttpException`, so the rest arrive here
 * unwrapped and would otherwise be reported as 500s: a client that sent a 50MB body
 * would be told the server is broken.
 */
interface HttpErrorShape {
  error: Error;
  statusCode: number;
  /** http-errors' own client-safety flag; `true` is its 4xx default. */
  expose: boolean;
}

/**
 * Narrows an unknown `Error` to the `http-errors` duck type: a numeric `statusCode`
 * (or `status`) inside the real error range. Nest's own `isHttpError` accepts any
 * numeric status, which would let an arbitrary status-carrying error nominate itself a
 * 200; the range check closes that.
 */
function findHttpErrorShape(error: Error): HttpErrorShape | null {
  const { statusCode, status, expose } = error as Error & {
    statusCode?: unknown;
    status?: unknown;
    expose?: unknown;
  };
  const code = typeof statusCode === 'number' ? statusCode : status;

  if (typeof code !== 'number' || !Number.isInteger(code) || code < 400 || code > 599) {
    return null;
  }
  return { error, statusCode: code, expose: expose === true };
}

/**
 * Last resort: anything that is neither an `ApiError` nor an `HttpException` -- a
 * Postgres driver error, a TypeError from a bad refactor, a thrown string.
 *
 * Everything that is not recognisably an HTTP error is redacted to "Internal server
 * error". An unexpected error's own message is internal detail: `pg` puts the failing
 * SQL and the constraint name in it, a DNS failure puts the hostname in it, and a
 * configuration error puts the connection string in it. The original survives in full
 * as `cause` in the log, which is the point of keeping `cause` off the wire -- this
 * filter can attach anything without having to judge whether it is safe to show.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly responder: ErrorResponder) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpError = exception instanceof Error ? findHttpErrorShape(exception) : null;

    const error = httpError
      ? this.fromHttpError(httpError)
      : new ApiError('Internal server error', {
          type: ApiErrorType.INTERNAL,
          cause:
            exception instanceof Error
              ? exception
              : // Wrap a thrown non-Error so the log still carries the value and the
                // responder still has a stack to print.
                new Error(`Non-Error value thrown: ${String(exception)}`),
        });

    this.responder.respond(error, host);
  }

  /**
   * The message reaches the client only for an exposable 4xx. A 5xx stays redacted
   * even if something set `expose`, and a bare status-carrying `Error` with no flag
   * fails closed to a generic message rather than guessing that it is safe.
   */
  private fromHttpError({ error, statusCode, expose }: HttpErrorShape): ApiError {
    const clientSafe = expose && statusCode < 500;

    return new ApiError(
      clientSafe
        ? error.message
        : statusCode >= 500
          ? 'Internal server error'
          : 'Request failed',
      {
        type: resolveApiErrorType(statusCode),
        statusCode,
        cause: error,
      },
    );
  }
}
