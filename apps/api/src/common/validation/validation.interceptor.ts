import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { ZodError } from 'zod';
import { ApiError, ApiErrorType } from '../errors/api.error';
import {
  VALIDATE_METADATA,
  VALIDATION_SLOTS,
  type ValidatedBag,
  type ValidatedRequest,
  type ValidationSlot,
  type ValidationSpec,
} from './validate.decorator';

/** One entry of `meta.fields` in a validation failure. */
export interface FieldError {
  /** Which part of the request the field is in. */
  in: ValidationSlot;
  /** Dot path from the root of that part; empty when the part itself is wrong. */
  path: string;
  messages: string[];
}

/**
 * Parses a route's declared input before the handler runs.
 *
 * An interceptor and not a pipe: a Nest pipe is handed `ArgumentMetadata` (the
 * parameter's type and position) and has no access to the route's own metadata, so it
 * cannot know which schema the route declared. It is registered ahead of the tenant
 * transaction interceptor, so a malformed request never opens a transaction; guards
 * have already run, so an unauthenticated caller never learns a schema.
 *
 * Results go to `request.validated` and the originals are left alone. Besides keeping
 * raw and parsed input from being confused, that avoids Express 5, where `req.query`
 * is a getter with no setter.
 *
 * Every declared slot is parsed before anything is thrown, so one response reports the
 * bad path parameter and the bad body together.
 */
@Injectable()
export class ValidationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.getAllAndOverride<ValidationSpec | undefined>(VALIDATE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<ValidatedRequest>();

    const validated: ValidatedBag = {};
    const fields: FieldError[] = [];

    for (const slot of VALIDATION_SLOTS) {
      const schema = spec?.[slot];
      if (!schema) continue;

      const result = schema.safeParse(request[slot]);
      if (result.success) validated[slot] = result.data;
      else fields.push(...toFieldErrors(slot, result.error));
    }

    if (fields.length > 0) {
      // The message is constant so log lines group; what differs is in `meta.fields`.
      throw new ApiError('Request validation failed', {
        type: ApiErrorType.VALIDATION,
        code: 'validation_failed',
        meta: { fields },
      });
    }

    // Always assigned, declared or not: anything left on the request under this name
    // by earlier middleware must not be mistaken for parsed input.
    request.validated = validated;
    return next.handle();
  }
}

/**
 * Zod issues grouped by field. An unknown-key issue names its keys in one issue at the
 * parent's path; it is split so each offending key is its own field, which is what a
 * form or a client log needs to point at.
 */
export function toFieldErrors(slot: ValidationSlot, error: ZodError): FieldError[] {
  const byPath = new Map<string, string[]>();
  const add = (path: PropertyKey[], message: string): void => {
    const key = path.map(String).join('.');
    byPath.set(key, [...(byPath.get(key) ?? []), message]);
  };

  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) add([...issue.path, key], 'Unrecognized field');
    } else {
      add(issue.path, issue.message);
    }
  }

  return [...byPath].map(([path, messages]) => ({ in: slot, path, messages }));
}
