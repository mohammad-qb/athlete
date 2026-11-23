import { rulesToCondition } from '@casl/ability/extra';
import { and, or, sql, type SQL } from 'drizzle-orm';
import type { Action, Subject } from '@athlete/contracts';
import { ApiError, ApiErrorType } from '../errors/api.error';
import type { AppAbility } from './ability';
import { negate, toSqlWhere, type ColumnMap } from './to-sql-where';

const UNRESTRICTED = Symbol('unrestricted');

/**
 * Turns "what may this principal `action` on `subject`?" into a WHERE predicate.
 *
 * Returns `undefined` when access is unrestricted (an administrator), a `SQL`
 * predicate when it is conditional (a coach), and THROWS `FORBIDDEN` when no rule
 * grants the action at all. That last case is the point of the function: the natural
 * bug in a query-filter helper is to return "no filter" when it finds no rule, which
 * turns a missing permission into every row in the table.
 *
 * The merge itself is CASL's (`rulesToCondition`), so the SQL direction inherits the
 * same priority semantics the in-memory matcher uses -- highest priority first, the
 * rule defined LAST wins:
 *
 *  - each conditional `can` is one OR branch -- any grant suffices;
 *  - a conditional `cannot` subtracts from every `can` of LOWER priority, so it is
 *    AND-ed onto those branches as a negation;
 *  - an unconditional rule ends the walk: nothing below it can change the answer.
 *
 * Only the leaves are ours: one rule's conditions -> one predicate, via `toSqlWhere`.
 */
export function accessibleBy(
  ability: AppAbility,
  action: Action,
  subject: Subject,
  columns: ColumnMap,
): SQL | undefined {
  const merged = rulesToCondition<AppAbility, SQL, SQL | typeof UNRESTRICTED>(
    ability.rulesFor(action, subject),
    (rule) => {
      // Only conditional rules reach here. `{}` is a condition that restricts nothing.
      const predicate = toSqlWhere(rule.conditions, columns) ?? sql`true`;
      return rule.inverted ? negate(predicate) : predicate;
    },
    {
      and: (predicates) => and(...predicates) as SQL,
      or: (predicates) => (predicates.length === 1 ? (predicates[0] as SQL) : (or(...predicates) as SQL)),
      empty: () => UNRESTRICTED,
    },
  );

  if (merged === null) {
    throw new ApiError(`Cannot ${action} ${subject}`, {
      type: ApiErrorType.FORBIDDEN,
      code: 'AUTHZ_NO_GRANT',
      meta: { action, subject },
    });
  }

  return merged === UNRESTRICTED ? undefined : merged;
}
