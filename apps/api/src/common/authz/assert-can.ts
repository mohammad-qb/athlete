import type { Action, Subject } from '@athlete/contracts';
import { ApiError, ApiErrorType } from '../errors/api.error';
import { requestContext } from '../tenancy/request-context';
import { asSubject, type SubjectRows } from './ability';

/**
 * The instance check: may the current principal `action` THIS row?
 *
 * Asked against the request's scoped ability, so it is the same policy the query
 * filters are compiled from -- CASL's matcher evaluating the same conditions in memory.
 * It is synchronous on purpose. The check it replaces was an awaited database read,
 * and a dropped `await` on that skipped authorization while type-checking cleanly;
 * there is no promise here to drop.
 *
 * `row` must carry EVERY field the subject's rules condition on, which `SubjectRows`
 * requires by type. That is not pedantry: CASL treats a missing field differently from
 * a null one, so a partially selected row can pass where the full row would not. Do not
 * cast around it.
 *
 * Use it where the caller already holds the fields: a loaded row, or a row about to be
 * written (`create` has no existing row for a filter to exclude). Reads are scoped by
 * the repository's access filter instead, and a row outside that filter is a 404 --
 * this is the 403 for a principal who names a scope key they do not hold.
 */
export function assertCan<S extends Subject>(action: Action, type: S, row: SubjectRows[S]): void {
  const { ability } = requestContext.require();
  if (ability.can(action, asSubject(type, row))) return;

  throw new ApiError(`Cannot ${action} this ${type} record`, {
    type: ApiErrorType.FORBIDDEN,
    code: 'AUTHZ_OUT_OF_SCOPE',
    meta: { action, subject: type },
  });
}
