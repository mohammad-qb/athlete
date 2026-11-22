import { SetMetadata } from '@nestjs/common';
import type { Action, Subject } from '@athlete/contracts';

export const PERMISSION_METADATA = 'athlete:permission';
export const PUBLIC_METADATA = 'athlete:public';
export const AUTHENTICATED_METADATA = 'athlete:authenticated';

export interface PermissionSpec {
  action: Action;
  subject: Subject;
}

/**
 * Declares what a route does, in the policy's own vocabulary. The guard asks the
 * COARSE ability whether the principal's role may ever do it; which rows it applies to
 * is the scoped ability's question, answered where the query is built.
 *
 * A route names an operation, not the roles allowed to perform it. Who holds the
 * operation is decided in exactly one place (`ability.ts`), so changing what a coach
 * may do is one edit there rather than a sweep across controllers.
 *
 * Both fields are typed from the contracts enums: a misspelled subject is a compile
 * error, not a route that silently matches no rule.
 */
export const Permission = (spec: PermissionSpec) => SetMetadata(PERMISSION_METADATA, spec);

/** The only way to opt a route out of authorization. Deliberately explicit and greppable. */
export const Public = () => SetMetadata(PUBLIC_METADATA, true);

/**
 * For the few routes that are about the caller rather than about a resource: "who am
 * I, and where may I act?". Any signed-in identity is admitted -- including one with no
 * role in any academy, which is exactly who most needs that answer.
 *
 * It is not a weaker `@Permission`. Such a route has no `(action, subject)` to name,
 * and inventing one would put a row in the policy that grants nothing real. A route
 * declares exactly one of `@Public`, `@Authenticated` and `@Permission`; the guard and
 * the route-coverage test both refuse any other count.
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_METADATA, true);
