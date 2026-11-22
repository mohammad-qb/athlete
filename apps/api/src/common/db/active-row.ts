import { isNull, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * THE definition of an active fact: not voided.
 *
 * Recorded facts (participation, assessments, memberships) are never deleted; a wrong
 * one is voided and replaced. Every read of a fact table applies this predicate -- the
 * registers and rosters in the feature repositories AND the scope resolution the
 * authorization policy is built from -- so that a voided row means the same thing
 * everywhere: it is on record, and it counts for nothing. A voided membership puts
 * nobody on a roster and grants no coach visibility of that athlete.
 *
 * It takes the table as a parameter and imports nothing from the schema, so it needs no
 * exception to the `no-sql-outside-repositories` boundary rule.
 */
export function isActive(table: { voidedAt: AnyColumn }): SQL {
  return isNull(table.voidedAt);
}
