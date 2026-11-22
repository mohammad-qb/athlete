import { Injectable, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from './api.error';

/**
 * The single terminal step for every failed request.
 *
 * The three exception filters differ only in how they NORMALISE a thrown value into an
 * `ApiError`. Serialisation and logging happen here, once, so every filter produces
 * byte-identical output and there is exactly one line of code that decides what a
 * client sees when something goes wrong. A second place that writes an error response
 * is a second error contract.
 */
@Injectable()
export class ErrorResponder {
  private readonly logger = new Logger(ErrorResponder.name);

  respond(error: ApiError, host: ArgumentsHost): void {
    this.log(error);

    const response = host.switchToHttp().getResponse<Response>();

    // An error thrown after the response has begun -- a stream, a file download --
    // cannot be given a JSON body: the status line is already on the wire and setting
    // a second one throws. Close the connection instead, which is what Nest's own
    // BaseExceptionFilter does, and let the client see a truncated response rather
    // than a crashed process.
    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(error.statusCode).json(error.toJSON());
  }

  /**
   * One log line per failed request, at the error's own severity.
   *
   * `meta` is logged for 5xx only. For a server fault it is often the only record of
   * what actually happened, and it is already on the wire so nothing new is disclosed.
   * For a 4xx it echoes client input -- a malformed field value, an unparseable id --
   * which is noise at best and someone else's data at worst.
   *
   * The `cause` chain is logged and never serialised, so a filter can attach a raw
   * driver error without weighing whether it leaks. For a redacted 500 this line is
   * the ONLY place the original message survives.
   */
  private log(error: ApiError): void {
    const fields = {
      event: 'http.request.failed',
      errorType: error.type,
      errorCode: error.code,
      statusCode: error.statusCode,
      cause: error.cause ? `${error.cause.name}: ${error.cause.message}` : undefined,
      ...(error.statusCode >= 500 && error.meta ? { meta: error.meta } : {}),
    };

    const line = `${error.message} ${JSON.stringify(fields)}`;

    switch (error.logLevel) {
      case 'error':
        // Nest's logger treats the second argument to error() as the stack trace.
        // Prefer the cause's: it points at the real origin, whereas the ApiError's own
        // stack stops at whichever filter wrapped it.
        this.logger.error(line, error.cause?.stack ?? error.stack);
        break;
      case 'warn':
        this.logger.warn(line);
        break;
      case 'info':
        this.logger.log(line);
        break;
      case 'debug':
        this.logger.debug(line);
        break;
    }
  }
}
