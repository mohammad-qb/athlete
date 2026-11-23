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
export const Role = z
  .enum(["platform_admin", "academy_admin", "coach", "athlete"])
  .meta({ id: "Role" });
export type Role = z.infer<typeof Role>;

export const AttendanceStatus = z
  .enum(["present", "absent", "late", "excused"])
  .meta({ id: "AttendanceStatus" });
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

/**
 * `sort` names one sortable key, ascending, or the same key behind a `-`, descending.
 * One parameter rather than a key and a direction, so a URL the SPA keeps in its
 * address bar round-trips as a single value.
 */
export type SortOf<Key extends string> = Key | `-${Key}`;

/**
 * The query string of every list route: `page`, `pageSize`, `sort`, `q`.
 *
 * Built per route because what a list can be sorted by is the route's own decision:
 * the keys are an enum, so `?sort=passwordHash` is a 400 naming the parameter and never
 * reaches an ORDER BY. Numbers are coerced, because a query string only carries text.
 *
 * `pageSize` stops at 100: the server decides how much one request may cost, and an
 * unbounded page size is the same full-table read this contract replaces.
 *
 * A route whose list has nothing to search drops `q` (`.omit({ q: true })`) instead of
 * accepting a parameter that does nothing.
 */
export function listQueryOf<const Key extends string>(
  sortable: readonly [Key, ...Key[]],
  defaultSort: SortOf<Key>,
) {
  const sorts = sortable.flatMap((key) => [key, `-${key}`]);
  // The enum is built from a computed list, which TypeScript cannot follow to the
  // literal union; the type is stated here once so every caller gets it.
  const sort = z.enum(sorts).default(defaultSort) as unknown as z.ZodDefault<
    z.ZodType<SortOf<Key>, SortOf<Key>>
  >;
  return strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort,
    q: z.string().trim().max(100).optional(),
  });
}

/** `-createdAt` -> `{ key: 'createdAt', descending: true }`. */
export function parseSort<Key extends string>(sort: SortOf<Key>): { key: Key; descending: boolean } {
  return sort.startsWith('-')
    ? { key: sort.slice(1) as Key, descending: true }
    : { key: sort as Key, descending: false };
}

/**
 * One page of a list. `total` counts every row the caller may see that matches the
 * filters -- not the rows in the table -- so it is safe to show and enough to draw a
 * pager from.
 */
export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

/** The shape `pageOf` describes, for code that builds one. */
export interface Page<Item> {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}
