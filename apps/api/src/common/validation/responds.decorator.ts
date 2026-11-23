import { applyDecorators, HttpCode, SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const RESPONDS_METADATA = 'athlete:responds';

export interface RespondsOptions {
  /**
   * The success status. Unset, it is Nest's own default for the method (201 for a POST,
   * 200 otherwise); set, it is applied to the route as well as documented, so the two
   * cannot disagree.
   */
  status?: number;
  /**
   * The resource is versioned: send its `version` as the `ETag` header. The header is
   * taken from the ENCODED body, so it can never name a version the body does not.
   */
  etag?: boolean;
}

export interface RespondsSpec {
  /** `null` for a route that answers with no body. */
  schema: ZodType | null;
  status?: number;
  etag: boolean;
}

/**
 * Declares what a route answers with. `ResponseInterceptor` encodes the handler's
 * result through the schema, so the declaration is the response: a field the schema
 * does not name is not sent, and a result that does not fit is a 500 rather than
 * whatever the handler happened to return.
 *
 * Route metadata for the same two reasons as `@Validate`: forgetting it is refused at
 * runtime and fails the route-coverage test, and it can be read without running
 * anything -- which is how the OpenAPI document gets every response schema.
 *
 * `@Responds(null)` is a route with no body: 204, and the handler must return nothing.
 *
 * Handler-level only. A response shape is a fact about one route, and inheriting one
 * from the controller would declare it for routes nobody looked at.
 */
export function Responds(schema: ZodType | null, options: RespondsOptions = {}): MethodDecorator {
  const status = options.status ?? (schema === null ? 204 : undefined);
  const spec: RespondsSpec = { schema, status, etag: options.etag ?? false };

  return applyDecorators(
    SetMetadata(RESPONDS_METADATA, spec),
    ...(status === undefined ? [] : [HttpCode(status)]),
  );
}
