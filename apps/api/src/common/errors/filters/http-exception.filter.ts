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
 *
 * Only the message is published, never the rest of the payload. An `HttpException`
 * can be constructed with any object, and nothing says its keys were meant for the
 * client: a guard or a third-party module that attaches internal state to a 4xx would
 * otherwise have it forwarded verbatim (which is what Nest's default filter does).
 * Structured, client-facing detail has exactly one route to the wire -- `ApiError`'s
 * `meta`, where whoever throws it chose it on purpose. The payload is not lost: the
 * exception is the `cause`, and the log carries it.
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
}
