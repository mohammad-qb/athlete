import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { parseIfMatch } from './optimistic-concurrency';

/**
 * Exported so the route walk can recognise the decorator in route-argument metadata
 * (Nest stores a custom decorator as `{ factory, data }`): that is how the OpenAPI
 * document knows which routes require `If-Match` without a second list of them.
 */
export function readIfMatch(_data: unknown, context: ExecutionContext): number {
  const { headers } = context
    .switchToHttp()
    .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  const header = headers['if-match'];
  return parseIfMatch(Array.isArray(header) ? header[0] : header);
}

/**
 * The version the caller says it is editing, from `If-Match`. Refuses the request
 * (400) when the header is missing or malformed, so a handler that takes this
 * parameter cannot run as an unconditional write.
 */
export const IfMatch = createParamDecorator(readIfMatch);
