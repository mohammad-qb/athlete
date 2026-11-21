import { BadRequestException, ConflictException } from '@nestjs/common';

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
    throw new BadRequestException('If-Match header is required for updates');
  }
  const normalised = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(normalised);
  if (!Number.isInteger(version) || version < 0) {
    throw new BadRequestException(`Malformed If-Match value: ${header}`);
  }
  return version;
}

export function formatETag(version: number): string {
  return `"${version}"`;
}

export function staleWrite(resource: string, expected: number): ConflictException {
  return new ConflictException({
    error: 'stale_write',
    message:
      `${resource} was modified by someone else since you loaded it ` +
      `(your version: ${expected}). Re-read the resource and reapply your change.`,
  });
}
