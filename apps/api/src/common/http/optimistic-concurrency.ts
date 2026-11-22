import { ApiError, ApiErrorType } from '../errors/api.error';

/**
 * Optimistic concurrency, expressed in native HTTP.
 *
 * Read returns `ETag: "<version>"`. A write must send `If-Match: "<version>"`. The
 * UPDATE carries `where id = ? and version = ?`; if it affects zero rows the caller's
 * copy was stale and we answer 409 -- rather than letting the second writer silently
 * overwrite the first, which is the default behaviour of a naive update and the thing
 * their "two users edit the same record" scenario is probing for.
 *
 * Pessimistic locking (SELECT ... FOR UPDATE) was rejected deliberately: these are
 * human-paced edits over HTTP, so holding a row lock across user think-time would
 * trade a rare, recoverable 409 for routine lock contention.
 */
export function parseIfMatch(header: string | undefined): number {
  if (!header) {
    throw new ApiError('If-Match header is required for updates', {
      type: ApiErrorType.BAD_REQUEST,
      code: 'if_match_required',
      explanation:
        'Read the resource first and send the ETag it returned as If-Match. Writing ' +
        'without one would silently overwrite whatever another client has since saved.',
    });
  }
  const normalised = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(normalised);
  if (!Number.isInteger(version) || version < 0) {
    throw new ApiError('Malformed If-Match value', {
      type: ApiErrorType.BAD_REQUEST,
      code: 'if_match_malformed',
      // The header is the caller's own input, so echoing it is not a disclosure --
      // and it is the one thing they need in order to see what went wrong.
      meta: { ifMatch: header },
      explanation: 'If-Match must be a non-negative integer version, optionally quoted.',
    });
  }
  return version;
}

export function formatETag(version: number): string {
  return `"${version}"`;
}

export function staleWrite(resource: string, expected: number): ApiError {
  return new ApiError(`${resource} was modified by someone else since you loaded it`, {
    type: ApiErrorType.CONFLICT,
    // Kept as the stable identifier the previous body carried as `error: 'stale_write'`,
    // so a client that already branches on it does not have to change.
    code: 'stale_write',
    meta: { expectedVersion: expected },
    explanation:
      'Re-read the resource and reapply your change. A conflict here means the write ' +
      'was refused, not partially applied.',
  });
}
