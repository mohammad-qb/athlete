import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  formatETag,
  parseIfMatch,
  staleWrite,
} from '../src/common/http/optimistic-concurrency';

describe('If-Match / ETag handling', () => {
  it('parses a quoted version', () => {
    expect(parseIfMatch('"7"')).toBe(7);
  });

  it('parses a weak validator', () => {
    expect(parseIfMatch('W/"3"')).toBe(3);
  });

  it('parses an unquoted version', () => {
    expect(parseIfMatch('0')).toBe(0);
  });

  it('requires the header: an update without one is a client error, not an overwrite', () => {
    expect(() => parseIfMatch(undefined)).toThrow(BadRequestException);
  });

  it('rejects a malformed validator rather than coercing it', () => {
    expect(() => parseIfMatch('"not-a-number"')).toThrow(BadRequestException);
    expect(() => parseIfMatch('"-1"')).toThrow(BadRequestException);
    expect(() => parseIfMatch('"1.5"')).toThrow(BadRequestException);
  });

  it('round-trips through formatETag', () => {
    expect(parseIfMatch(formatETag(42))).toBe(42);
  });

  it('reports a stale write as 409 with recovery instructions', () => {
    const error = staleWrite('Athlete', 3);
    expect(error).toBeInstanceOf(ConflictException);
    const body = error.getResponse() as { error: string; message: string };
    expect(body.error).toBe('stale_write');
    expect(body.message).toContain('Re-read the resource');
  });
});
