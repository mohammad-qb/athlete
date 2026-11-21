import type { Config } from 'drizzle-kit';

/**
 * Migrations are hand-written SQL in ./drizzle, not generated from the schema.
 * That is deliberate: RLS policies, FORCE ROW LEVEL SECURITY, GiST exclusion
 * constraints, generated range columns and SECURITY DEFINER functions cannot be
 * expressed in a schema DSL, and they are the parts carrying the guarantees.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
