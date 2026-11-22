import { describe, expect, it } from 'vitest';
import { ApiError, ApiErrorType } from '../src/common/errors/api.error';
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
    expect(() => parseIfMatch(undefined)).toThrow(ApiError);
    try {
      parseIfMatch(undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(400);
      expect((error as ApiError).code).toBe('if_match_required');
    }
  });

  it('rejects a malformed validator rather than coercing it', () => {
    for (const header of ['"not-a-number"', '"-1"', '"1.5"']) {
      expect(() => parseIfMatch(header)).toThrow(ApiError);
    }
  });

  it('round-trips through formatETag', () => {
    expect(parseIfMatch(formatETag(42))).toBe(42);
  });

  it('reports a stale write as 409 in the error taxonomy, with recovery instructions', () => {
    const error = staleWrite('Athlete', 3);

    expect(error).toBeInstanceOf(ApiError);
    const body = error.toJSON();
    expect(body.statusCode).toBe(409);
    expect(body.type).toBe(ApiErrorType.CONFLICT);
    expect(body.code).toBe('stale_write');
    // The version the caller held is machine-readable, so a client can decide whether
    // to merge or refetch without parsing prose.
    expect(body.meta).toEqual({ expectedVersion: 3 });
    expect(body.explanation).toContain('Re-read the resource');
  });
});
