import { Injectable } from '@nestjs/common';
import {
  PermissionAction,
  Subject,
  type GrantedPermission,
  type MeResponse,
} from '@athlete/contracts';
import { defineAbility } from '../../common/authz/ability';
import type { Principal } from '../../common/authz/principal';
import { ApiError, ApiErrorType } from '../../common/errors/api.error';
import { AuthSessionStore } from './auth-session.store';
import type { CurrentSessionValue } from './current-session.decorator';

/**
 * Every `(action, subject)` pair the principal's roles could ever exercise: the COARSE
 * ability -- the same one `AuthorizationGuard` consults -- asked once per pair.
 *
 * Asked, not restated. There is no second table of "what a coach may do" here to drift
 * from `ability.ts`; a grant added there appears in `/me` without this file changing.
 */
export function permissionsFor(principal: Principal | undefined): GrantedPermission[] {
  if (!principal) return [];

  const ability = defineAbility(principal, { scoped: false });
  return Subject.options.flatMap((subject) =>
    PermissionAction.options
      .filter((action) => ability.can(action, subject))
      .map((action) => ({ action, subject })),
  );
}

export function toMeResponse(session: CurrentSessionValue): MeResponse {
  return {
    user: {
      id: session.identity.userId,
      email: session.identity.email,
      name: session.identity.name,
    },
    activeAcademyId: session.principal?.academyId ?? null,
    academies: session.memberships.map(({ id, name, roles }) => ({ id, name, roles })),
    permissions: permissionsFor(session.principal),
  };
}

@Injectable()
export class MeService {
  constructor(private readonly sessions: AuthSessionStore) {}

  describe(session: CurrentSessionValue): MeResponse {
    return toMeResponse(session);
  }

  /**
   * Moves the session to another academy the user belongs to. The membership list is
   * the one read from the database for THIS request, so a role revoked a moment ago
   * cannot be switched into.
   */
  async switchAcademy(session: CurrentSessionValue, academyId: string): Promise<MeResponse> {
    const target = session.memberships.find((membership) => membership.id === academyId);
    if (!target) {
      // The same answer whether the academy does not exist or exists and is not the
      // caller's: a refusal that told the two apart would confirm academy ids.
      throw new ApiError('You do not belong to this academy', {
        type: ApiErrorType.FORBIDDEN,
        code: 'not_a_member',
      });
    }

    await this.sessions.setActiveAcademy(session.identity.sessionId, target.id);

    return toMeResponse({
      ...session,
      principal: { userId: session.identity.userId, academyId: target.id, roles: target.roles },
    });
  }
}
