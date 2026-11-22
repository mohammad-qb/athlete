import type { z } from 'zod';

/**
 * A list contract's query schema (`listQueryOf` in `@athlete/contracts`) as a route's
 * search-params validator.
 *
 * The same schema the API validates the query string with validates the address bar,
 * so the two cannot disagree about what a page, a page size or a sortable key is. One
 * difference: the API answers a bad query with a 400, and a URL someone edited by hand
 * should not be an error page. Anything the schema refuses becomes the list's defaults.
 */
export function listSearch<Schema extends z.ZodType>(schema: Schema) {
  return schema.catch(() => schema.parse({}));
}
