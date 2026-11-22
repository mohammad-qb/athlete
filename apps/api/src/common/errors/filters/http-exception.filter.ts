import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ApiError } from '../api.error';
import { ErrorResponder } from '../error-responder';
import { resolveApiErrorType } from './status-type';

/**
 * Normalises Nest's own `HttpException` family into the one wire shape, keeping its
 * status and its human message.
 *
 * This filter is what lets application code migrate to `ApiError` incrementally
 * without the API speaking two dialects in the meantime: a `NotFoundException` thrown
 * from a service and an `ApiError` of type NOT_FOUND produce the same body. It also
 * covers the exceptions this codebase will never throw itself -- the router's 404 for
 * an unrouted path, a guard's refusal.
 *
 * A 5xx is redacted exactly as the catch-all redacts one. Nest's default filter
 * publishes an `HttpException`'s message whatever its status, so
 * `new InternalServerErrorException(dbError.message)` would put the failing SQL on the
 * wire -- and being matched by this filter rather than the catch-all is not a statement
 * that the message is client-safe, only that someone chose a status. The message
 * survives as `cause` in the log.
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly responder: ErrorResponder) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const statusCode = exception.getStatus();
    const serverFault = statusCode >= 500;

    this.responder.respond(
      new ApiError(
        serverFault ? 'Internal server error' : this.extractMessage(exception),
        {
          type: resolveApiErrorType(statusCode),
          statusCode,
          // `meta` is the payload the thrower attached. For a 4xx that is structured
          // client-facing detail; for a 5xx it is internal state, and the responder
          // logs 5xx `meta` anyway, so dropping it here loses nothing but the leak.
          meta: serverFault ? undefined : this.extractMeta(exception),
          cause: exception,
        },
      ),
      host,
    );
  }

  /**
   * `HttpException#message` is unreliable: for an object payload whose `message` is
   * not a plain string it degrades to the class name spelled out ("Not Found
   * Exception"). Read the response payload directly instead.
   *
   * Only ever called for a 4xx; a 5xx never reaches the client's eyes.
   */
  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;

    if (typeof response === 'object' && response !== null) {
      const { message } = response as { message?: unknown };
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.map(String).join('; ');
    }
    return exception.message;
  }

  /**
   * Carries forward the structured detail a 4xx exception was thrown with -- the Zod
   * issue list, a conflict's expected version -- so normalising does not flatten a
   * body that was already machine-readable into a bare sentence.
   *
   * Nest's own three keys are dropped: `message` and `error` are the prose fields and
   * are already represented above, and `statusCode` is a top-level field of the
   * response -- repeating it inside `meta` would be the only content of `meta` for
   * every stock Nest exception.
   */
  private extractMeta(exception: HttpException): Record<string, unknown> | undefined {
    const response = exception.getResponse();
    if (typeof response !== 'object' || response === null) return undefined;

    const {
      message: _message,
      error: _error,
      statusCode: _statusCode,
      ...rest
    } = response as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
}
