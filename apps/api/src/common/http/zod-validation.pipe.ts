import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validation uses the schemas from @athlete/contracts -- the same objects the OpenAPI
 * document and the generated client are produced from. One definition, so a contract
 * change cannot pass validation here and fail in the browser.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        // A `message` is supplied deliberately. Nest degrades a payload without one to
        // the class name spelled out ("Bad Request Exception"), which is what the error
        // contract would then publish as the human-readable half of a validation
        // failure. Phase 5 of docs/plans/backend-foundations.md replaces this pipe
        // outright; until then the body should still say something true.
        message: 'Request validation failed',
        error: 'validation_failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
