import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApiError, ApiErrorType } from '../../common/errors/api.error';
import type {
  AcademyMembership,
  AuthenticatedRequest,
  Identity,
  Principal,
} from '../../common/authz/principal';

/** The signed-in caller, as `AuthenticationGuard` resolved it for this request. */
export interface CurrentSessionValue {
  identity: Identity;
  memberships: AcademyMembership[];
  /** Absent when the identity belongs to no academy. */
  principal?: Principal;
}

/** Exported for the unit test; handlers use `@CurrentSession()`. */
export function readCurrentSession(_data: unknown, context: ExecutionContext): CurrentSessionValue {
  const { identity, memberships, principal } = context
    .switchToHttp()
    .getRequest<AuthenticatedRequest>();

  // Unreachable behind @Authenticated or @Permission, which have already refused an
  // anonymous request. If it is reached, a route reads the session without declaring
  // that it needs one -- a server mistake, so a 500 whose reason goes to the log.
  if (!identity) {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    throw new ApiError('Internal server error', {
      type: ApiErrorType.INTERNAL,
      code: 'session_not_resolved',
      cause: new Error(`${handler} reads the current session but admits anonymous requests.`),
    });
  }

  return { identity, memberships: memberships ?? [], principal };
}

/** The caller's identity, academies and active principal. Not request input: nothing here is client-supplied. */
export const CurrentSession = createParamDecorator(readCurrentSession);
