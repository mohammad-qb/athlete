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

/**
 * Every REQUEST schema is built with this, never with `z.object`.
 *
 * `z.object` strips keys it does not know, so a misspelled field validates to an object
 * without it. On a PATCH that meant `{"dateofBirth": ...}` parsed to `{}`, the update
 * ran, the version was bumped, and the caller got a 200 for a change that never
 * happened -- while every other client's ETag went stale. A strict object refuses the
 * unknown key instead, so the caller hears about the typo.
 *
 * Response schemas stay `z.object`: adding a field to a response must not break a
 * client that validates what it receives.
 */
export const strictObject = z.strictObject;

/**
 * The PATCH form of a request schema: every field optional, at least one present.
 * An empty patch is refused for the same reason as an unknown key -- a write that
 * changes nothing should not report success and move the version.
 */
export function patchOf<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema
    .partial()
    .refine((value) => Object.values(value).some((field) => field !== undefined), {
      message: 'At least one field must be provided',
      // Only when the fields themselves are clean. A body holding nothing but a
      // misspelled key is already refused for the key; adding "provide a field" to
      // that would point the caller away from the actual mistake.
      when: (payload) => payload.issues.length === 0,
    });
}

/** Path parameters of every `/:id` route. */
export const IdParams = strictObject({ id: Uuid });
export type IdParams = z.infer<typeof IdParams>;
