import { z } from "zod";

/**
 * z.guid(), NOT z.uuid().
 *
 * Zod 4's z.uuid() enforces RFC 9562 version and variant bits, so it rejects ids that
 * Postgres's `uuid` type stores perfectly happily -- anything whose variant nibble is
 * not 8/9/a/b, which includes most hand-written and legacy identifiers. Validating more
 * strictly than the database means the API can refuse to return a row it is holding.
 * z.guid() matches the storage layer's definition while still rejecting genuine junk.
 */
export const Uuid = z.guid();
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Roles are coarse and static. "Responsibilities" (which teams) are relational and live in data. */
export const Role = z.enum([
  "platform_admin",
  "academy_admin",
  "coach",
  "athlete",
]);
export type Role = z.infer<typeof Role>;

export const AttendanceStatus = z.enum([
  "present",
  "absent",
  "late",
  "excused",
]);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

/**
 * Every mutable resource carries a version. It is returned as an ETag and required
 * back as If-Match, so a stale write is rejected with 409 instead of silently winning.
 */
export const Versioned = z.object({ version: z.number().int().nonnegative() });
