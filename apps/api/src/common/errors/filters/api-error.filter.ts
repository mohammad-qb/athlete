import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ApiError } from '../api.error';
import { ErrorResponder } from '../error-responder';

/**
 * The intended path: application code throws `ApiError`, which already carries status,
 * type and severity. Nothing to normalise.
 */
@Catch(ApiError)
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly responder: ErrorResponder) {}

  catch(exception: ApiError, host: ArgumentsHost): void {
    this.responder.respond(exception, host);
  }
}
