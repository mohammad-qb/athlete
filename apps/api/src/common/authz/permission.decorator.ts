import { SetMetadata } from '@nestjs/common';
import type { Action, Subject } from '@athlete/contracts';

export const PERMISSION_METADATA = 'athlete:permission';
export const PUBLIC_METADATA = 'athlete:public';

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
