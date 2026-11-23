import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError, ApiErrorType } from '../errors/api.error';

export const VALIDATE_METADATA = 'athlete:validate';

/** The three places a request carries input a handler reads. */
export const VALIDATION_SLOTS = ['params', 'query', 'body'] as const;
export type ValidationSlot = (typeof VALIDATION_SLOTS)[number];

export type ValidationSpec = Partial<Record<ValidationSlot, ZodType>>;

/** Where the interceptor leaves parsed input, and the only place a handler reads it from. */
export type ValidatedBag = Partial<Record<ValidationSlot, unknown>>;
export interface ValidatedRequest {
  body?: unknown;
  params?: unknown;
  query?: unknown;
  validated?: ValidatedBag;
}

/**
 * Declares the schemas a route's input must satisfy. `ValidationInterceptor` parses
 * each declared slot before the handler runs and stores the result on
 * `request.validated`.
 *
 * Route metadata rather than a per-parameter pipe, for two reasons. A pipe is attached
 * where the parameter is declared, so forgetting it is silent: the handler receives
 * raw input and nothing fails. And metadata can be read without running anything, so
 * the route-coverage test can assert that every route taking input declares a schema
 * for it.
 */
export const Validate = (spec: ValidationSpec) => SetMetadata(VALIDATE_METADATA, spec);

/** What a `@Valid*()` decorator asks for; read by the route-coverage test as well. */
export interface ValidSlotRequest {
  slot: ValidationSlot;
  /** One property of the parsed slot instead of the whole object. */
  key?: string;
}

/**
 * Exported so the coverage test can recognise these decorators in route-argument
 * metadata: Nest stores a custom decorator as `{ factory, data }`, and `factory` is
 * this function.
 */
export function readValidated(request: ValidSlotRequest, context: ExecutionContext): unknown {
  const { validated } = context.switchToHttp().getRequest<ValidatedRequest>();

  // FAIL CLOSED. An empty slot means the route did not declare a schema for the input
  // it is about to read. Handing over `request.body` instead would be the convenient
  // behaviour and exactly the defect this layer exists to remove, so the request is
  // refused. It is a 500 because the mistake is the server's, and the reason goes to
  // the log, not to the client.
  if (!validated || !(request.slot in validated)) {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    throw new ApiError('Internal server error', {
      type: ApiErrorType.INTERNAL,
      code: 'validation_not_declared',
      cause: new Error(
        `${handler} reads the request ${request.slot} but declares no schema for it. ` +
          `Add @Validate({ ${request.slot}: <schema> }).`,
      ),
    });
  }

  const value = validated[request.slot];
  if (request.key === undefined) return value;
  return (value as Record<string, unknown> | null | undefined)?.[request.key];
}

const validSlot = createParamDecorator(readValidated);

/** The parsed body. Throws unless the route declares `@Validate({ body })`. */
export const ValidBody = () => validSlot({ slot: 'body' });

/** The parsed path parameters, or one of them. Throws unless `@Validate({ params })`. */
export const ValidParams = (key?: string) => validSlot({ slot: 'params', key });

/** The parsed query string, or one parameter. Throws unless `@Validate({ query })`. */
export const ValidQuery = (key?: string) => validSlot({ slot: 'query', key });
