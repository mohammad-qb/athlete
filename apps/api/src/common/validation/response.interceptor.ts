import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { ApiError, ApiErrorType } from '../errors/api.error';
import { formatETag } from '../http/optimistic-concurrency';
import { RESPONDS_METADATA, type RespondsSpec } from './responds.decorator';

/**
 * Encodes every response through the schema its route declared with `@Responds`.
 *
 * The mirror image of `ValidationInterceptor`, and for the mirrored reason. Without it
 * a handler's return value goes to the wire as-is: a repository row returned by
 * mistake carries every column it has, and the OpenAPI document describes a shape
 * nothing enforces. With it the schema is the only way out. An undeclared field is
 * stripped, and a result the schema refuses is `response_contract_violation` -- a 500,
 * because the mistake is the server's, with the reason in the log and nothing of the
 * offending value on the wire.
 *
 * FAIL CLOSED, and early. A route with no `@Responds` is refused BEFORE its handler
 * runs, so the missing declaration cannot be a write that happened and then failed to
 * report.
 *
 * Registered last, which makes it the innermost interceptor: a violation is thrown
 * inside the tenant transaction and rolls it back. A write whose result cannot be
 * reported is not left committed behind a 500.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const spec = this.reflector.get<RespondsSpec | undefined>(
      RESPONDS_METADATA,
      context.getHandler(),
    );

    if (!spec) {
      throw new ApiError('Internal server error', {
        type: ApiErrorType.INTERNAL,
        code: 'response_not_declared',
        cause: new Error(
          `${handler} declares no response schema. Add @Responds(<schema>), or @Responds(null) for no body.`,
        ),
      });
    }

    return next.handle().pipe(map((result) => this.encode(spec, result, handler, context)));
  }

  private encode(
    spec: RespondsSpec,
    result: unknown,
    handler: string,
    context: ExecutionContext,
  ): unknown {
    if (spec.schema === null) {
      if (result !== undefined) {
        throw violation(`${handler} declares no response body and returned one.`);
      }
      return undefined;
    }

    const parsed = spec.schema.safeParse(result);
    if (!parsed.success) {
      // Paths and messages only. The value that failed is the thing that must not leak,
      // and a log is one more place for it to leak to.
      throw violation(
        `${handler} returned a value its response schema refuses:\n${z.prettifyError(parsed.error)}`,
      );
    }

    if (spec.etag) {
      const version = (parsed.data as { version?: unknown } | null)?.version;
      if (typeof version !== 'number' || !Number.isInteger(version)) {
        throw violation(`${handler} declares an ETag and its response carries no integer version.`);
      }
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader('ETag', formatETag(version));
    }

    return parsed.data;
  }
}

function violation(reason: string): ApiError {
  return new ApiError('Internal server error', {
    type: ApiErrorType.INTERNAL,
    code: 'response_contract_violation',
    cause: new Error(reason),
  });
}
