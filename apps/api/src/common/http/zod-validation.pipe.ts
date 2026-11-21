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
