import { describe, expect, it } from 'vitest';
import { ApiError, ApiErrorType } from '../src/common/errors/api.error';

/**
 * PROVES: the error taxonomy is a contract, not a convention.
 *
 * Three properties are asserted here because each one has a plausible wrong answer
 * that would be invisible in review: the status a type maps to, the severity that
 * status is logged at, and what `toJSON` is willing to put on the wire.
 */
describe('ApiError status mapping', () => {
  const expected: [ApiErrorType, number][] = [
    [ApiErrorType.VALIDATION, 400],
    [ApiErrorType.BAD_REQUEST, 400],
    [ApiErrorType.UNAUTHORIZED, 401],
    [ApiErrorType.FORBIDDEN, 403],
    [ApiErrorType.NOT_FOUND, 404],
    [ApiErrorType.CONFLICT, 409],
    [ApiErrorType.RATE_LIMIT, 429],
    [ApiErrorType.INTERNAL, 500],
    [ApiErrorType.DATABASE, 500],
    [ApiErrorType.TIMEOUT, 504],
    [ApiErrorType.UNKNOWN, 500],
  ];

  it.each(expected)('%s maps to %i', (type, statusCode) => {
    expect(new ApiError('x', { type }).statusCode).toBe(statusCode);
  });

  it('covers every declared type, so adding one without a status fails here', () => {
    expect(expected.map(([type]) => type).sort()).toEqual(Object.values(ApiErrorType).sort());
  });

  /**
   * The deliberate divergence from the implementation this was adapted from, which
   * maps UNKNOWN to 400. An unclassified error is not known to be the client's fault,
   * and -- because severity is derived from status -- a 400 would also be logged at
   * `warn`, keeping every unclassified server fault out of error-level alerting. The
   * failure mode of that choice is a service that is broken and quiet.
   */
  it('defaults an unclassified error to 500 at error level, not 400 at warn', () => {
    const error = new ApiError('something went wrong');
    expect(error.type).toBe(ApiErrorType.UNKNOWN);
    expect(error.statusCode).toBe(500);
    expect(error.logLevel).toBe('error');
  });

  it('lets an explicit status override the type default', () => {
    expect(new ApiError('x', { type: ApiErrorType.INTERNAL, statusCode: 503 }).statusCode).toBe(
      503,
    );
  });
});

describe('ApiError log level', () => {
  it('derives error for 5xx and warn for 4xx, so expected failures do not page anyone', () => {
    expect(new ApiError('x', { type: ApiErrorType.DATABASE }).logLevel).toBe('error');
    expect(new ApiError('x', { type: ApiErrorType.NOT_FOUND }).logLevel).toBe('warn');
  });

  it('honours an explicit level', () => {
    expect(new ApiError('x', { type: ApiErrorType.NOT_FOUND, logLevel: 'debug' }).logLevel).toBe(
      'debug',
    );
  });
});

describe('ApiError serialisation', () => {
  it('omits cause, so a filter can attach a raw driver error without leaking it', () => {
    const cause = new Error('password authentication failed for user "athlete_app"');
    const error = new ApiError('Internal server error', {
      type: ApiErrorType.DATABASE,
      cause,
    });

    const body = error.toJSON();
    expect('cause' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('password');

    // ...but the cause is still reachable for the log.
    expect(error.cause).toBe(cause);
  });

  it('carries the full contract when every field is set', () => {
    const body = new ApiError('Athlete was modified by someone else', {
      type: ApiErrorType.CONFLICT,
      code: 'stale_write',
      meta: { expectedVersion: 4 },
      explanation: 'Re-read the resource and reapply your change.',
    }).toJSON();

    expect(body).toEqual({
      statusCode: 409,
      name: 'ApiError',
      message: 'Athlete was modified by someone else',
      type: 'CONFLICT',
      code: 'stale_write',
      explanation: 'Re-read the resource and reapply your change.',
      meta: { expectedVersion: 4 },
    });
  });

  it('drops absent optional fields from the wire rather than sending nulls', () => {
    const body = new ApiError('Athlete not found', { type: ApiErrorType.NOT_FOUND }).toJSON();
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      statusCode: 404,
      name: 'ApiError',
      message: 'Athlete not found',
      type: 'NOT_FOUND',
    });
  });

  it('is a real Error, so an existing catch(e) still works and the stack is kept', () => {
    const error = new ApiError('x', { type: ApiErrorType.FORBIDDEN });
    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeTruthy();
  });
});
