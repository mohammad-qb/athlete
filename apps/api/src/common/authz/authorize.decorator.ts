import { SetMetadata } from '@nestjs/common';
import type { Role } from '@athlete/contracts';

export const AUTHZ_METADATA = 'athlete:authz';
export const PUBLIC_METADATA = 'athlete:public';

export interface AuthorizeSpec {
  /** Coarse, static check performed by the guard before the handler runs. */
  roles: Role[];
}

/**
 * Declares the roles permitted to reach a route. This is the COARSE half of
 * authorization. Resource-level questions ("may this coach read THIS athlete?") are
 * relational and temporal, so they are answered inside the service with a policy
 * function -- where they are testable and produce a real 403 rather than an
 * inexplicably empty result set.
 */
export const Authorize = (spec: AuthorizeSpec) => SetMetadata(AUTHZ_METADATA, spec);

/** The only way to opt a route out of authorization. Deliberately explicit and greppable. */
export const Public = () => SetMetadata(PUBLIC_METADATA, true);
