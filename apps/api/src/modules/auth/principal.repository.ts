import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Role } from '@athlete/contracts';
import type { AcademyMembership } from '../../common/authz/principal';
import type { RequestContext } from '../../common/tenancy/request-context';

/** A transaction on the application role's pool, as the request context types it. */
type AppTx = RequestContext['tx'];

/**
 * Which academies a user belongs to, and with which roles.
 *
 * Asked on every authenticated request and never cached in the session: a role that
 * was revoked a minute ago is gone on the next request, which is the property a
 * session row buys over a signed token.
 *
 * It runs as the application role with NO tenant key, so RLS hides every
 * `user_academy_roles` row from a direct query. The answer comes from
 * `app_academies_for_user()`, the schema's single SECURITY DEFINER function, which
 * returns role grants and academy names and nothing else.
 *
 * It takes the transaction as a parameter, like `PrincipalScopeRepository` and for the
 * same reason: it runs before a request context exists. The caller opens it with
 * `DatabaseService.runUnscoped`, so a repository never reaches for the database
 * service itself (the `no-repository-to-service` boundary).
 */
@Injectable()
export class PrincipalRepository {
  /** Sorted by academy name, then id, so "the first academy" is the same one every time. */
  async academiesFor(tx: AppTx, userId: string): Promise<AcademyMembership[]> {
    const result = await tx.execute<{ academy_id: string; academy_name: string; role: string }>(
      sql`select academy_id, academy_name, role from app_academies_for_user(${userId}::uuid)`,
    );

    const byAcademy = new Map<string, AcademyMembership>();
    for (const row of result.rows) {
      // A role this API version does not know grants nothing, rather than failing the
      // request: the database's CHECK may be widened by a migration that ships first.
      const role = Role.safeParse(row.role);
      if (!role.success) continue;

      const membership = byAcademy.get(row.academy_id) ?? {
        id: row.academy_id,
        name: row.academy_name,
        roles: [],
      };
      membership.roles.push(role.data);
      byAcademy.set(row.academy_id, membership);
    }

    return [...byAcademy.values()]
      .map((membership) => ({ ...membership, roles: [...membership.roles].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  }
}
