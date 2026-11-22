import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, toApiError } from './client';
import { configureErrorMapper, handleApiError } from './errors';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

function apiError(init: Partial<ConstructorParameters<typeof ApiError>[0]> & { status: number }) {
  return new ApiError({ type: 'UNKNOWN', message: 'server message', ...init });
}

const validation = apiError({
  status: 400,
  type: 'VALIDATION',
  code: 'validation_failed',
  message: 'Validation failed',
  fields: [
    { in: 'body', path: 'firstName', messages: ['Too short'] },
    { in: 'body', path: 'firstName', messages: ['Letters only'] },
    { in: 'body', path: 'dateOfBirth', messages: ['expected YYYY-MM-DD'] },
    { in: 'query', path: 'page', messages: ['must be a number'] },
  ],
});

describe('handleApiError', () => {
  const onUnauthorized = vi.fn();

  beforeEach(() => {
    toastError.mockClear();
    onUnauthorized.mockClear();
    configureErrorMapper({ onUnauthorized });
  });

  it('gives a validation failure to the form, by body field, and shows no toast', () => {
    const setFieldErrors = vi.fn();
    expect(handleApiError(validation, { setFieldErrors })).toBe('fields');
    expect(setFieldErrors).toHaveBeenCalledWith({
      firstName: ['Too short', 'Letters only'],
      dateOfBirth: ['expected YYYY-MM-DD'],
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts a validation failure when there is no form to give it to', () => {
    expect(handleApiError(validation)).toBe('toast');
    expect(toastError).toHaveBeenCalledWith('Validation failed');
  });

  it('toasts a validation failure that names no body field', () => {
    const setFieldErrors = vi.fn();
    const queryOnly = apiError({
      status: 400,
      type: 'VALIDATION',
      message: 'Validation failed',
      fields: [{ in: 'query', path: 'page', messages: ['must be a number'] }],
    });
    expect(handleApiError(queryOnly, { setFieldErrors })).toBe('toast');
    expect(setFieldErrors).not.toHaveBeenCalled();
  });

  it('hands a stale write to the conflict handler', () => {
    const onConflict = vi.fn();
    const stale = apiError({ status: 409, type: 'CONFLICT', code: 'stale_write' });
    expect(handleApiError(stale, { onConflict })).toBe('conflict');
    expect(onConflict).toHaveBeenCalledWith(stale);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts a stale write when nothing can resolve it', () => {
    expect(handleApiError(apiError({ status: 409, type: 'CONFLICT', code: 'stale_write' }))).toBe(
      'toast',
    );
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Someone else changed'));
  });

  it('shows the server message for a conflict that is not a stale write', () => {
    const overlap = apiError({
      status: 409,
      type: 'CONFLICT',
      code: 'membership_overlap',
      message: 'The athlete is already on a team in that period',
    });
    const onConflict = vi.fn();
    expect(handleApiError(overlap, { onConflict })).toBe('toast');
    expect(onConflict).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('The athlete is already on a team in that period');
  });

  it('treats a 401 as the end of the session, without a toast', () => {
    expect(handleApiError(apiError({ status: 401, type: 'UNAUTHORIZED' }))).toBe('unauthorized');
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'You do not have permission to do that.'],
    [404, 'That record no longer exists, or you do not have access to it.'],
    [429, 'Too many requests. Wait a moment and try again.'],
    [500, 'Something went wrong on our side. Try again in a moment.'],
    [503, 'Something went wrong on our side. Try again in a moment.'],
  ])('shows one consistent toast for a %i, not the server text', (status, message) => {
    expect(handleApiError(apiError({ status }))).toBe('toast');
    expect(toastError).toHaveBeenCalledWith(message);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('falls back to the server message for a code it does not know', () => {
    const odd = apiError({ status: 422, code: 'something_new', message: 'A new kind of refusal' });
    expect(handleApiError(odd)).toBe('toast');
    expect(toastError).toHaveBeenCalledWith('A new kind of refusal');
  });

  it('reports a request that got no response as a connection problem', () => {
    expect(handleApiError(new TypeError('Failed to fetch'))).toBe('toast');
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Could not reach the server'));
  });
});

describe('toApiError', () => {
  it("reads the API's error body, taking the status from the response", () => {
    const error = toApiError(
      {
        statusCode: 400,
        name: 'ValidationError',
        message: 'Validation failed',
        type: 'VALIDATION',
        code: 'validation_failed',
        meta: { fields: [{ in: 'body', path: 'lastName', messages: ['Required'] }, 'junk'] },
      },
      new Response(null, { status: 400 }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, type: 'VALIDATION', code: 'validation_failed' });
    expect(error.fields).toEqual([{ in: 'body', path: 'lastName', messages: ['Required'] }]);
  });

  it('keeps the status of an answer that is not the API\'s (a proxy error page)', () => {
    const error = toApiError('<html>Bad Gateway</html>', new Response(null, { status: 502 }));
    expect(error).toMatchObject({ status: 502, type: 'UNKNOWN' });
  });

  it('marks a missing response as status 0', () => {
    expect(toApiError(new TypeError('Failed to fetch'))).toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('returns an ApiError unchanged', () => {
    const error = apiError({ status: 404 });
    expect(toApiError(error)).toBe(error);
  });
});
