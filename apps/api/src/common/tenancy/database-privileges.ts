import { sql } from 'drizzle-orm';
import type { DatabaseService } from './database.service';

/**
 * The privilege matrix of `0002_grants.sql`, restated: per table, the table-level
 * privileges the application role may hold and the columns it may UPDATE without one.
 *
 * Deliberately a second copy. The migration says what was granted; this says what the
 * API is prepared to run with, and boot fails when the database holds MORE. Only these
 * tables are checked: a table added by a later migration is not judged by an API
 * version that has never heard of it, so migrating ahead of a deploy stays safe.
 *
 * Order of release follows from that: a migration that WIDENS a grant on one of these
 * tables must ship after the API version whose matrix allows it, or the running API
 * refuses its next restart.
 */
const READ_APPEND = ['SELECT', 'INSERT'] as const;
const READ_WRITE = ['SELECT', 'INSERT', 'UPDATE'] as const;
const VOIDING = ['voided_at', 'voided_by'] as const;

export const PRIVILEGE_MATRIX: Readonly<
  Record<string, { table: readonly string[]; updatableColumns: readonly string[] }>
> = {
  _migrations: { table: [], updatableColumns: [] },
  users: { table: [], updatableColumns: [] },
  academies: { table: ['SELECT'], updatableColumns: [] },
  user_academy_roles: { table: ['SELECT'], updatableColumns: [] },
  athletes: { table: READ_WRITE, updatableColumns: [] },
  teams: { table: READ_WRITE, updatableColumns: [] },
  training_sessions: { table: READ_WRITE, updatableColumns: [] },
  team_coach_assignments: { table: READ_APPEND, updatableColumns: ['valid_to'] },
  team_memberships: { table: READ_APPEND, updatableColumns: ['valid_to', ...VOIDING] },
  session_participants: { table: READ_APPEND, updatableColumns: VOIDING },
  assessments: { table: READ_APPEND, updatableColumns: VOIDING },
};

/**
 * Every privilege kind Postgres can grant on a table, and the subset it can also grant
 * on a single column. Probing all of them is the point: a kind left off these lists is
 * a grant the boot check cannot see. `has_table_privilege` is false for a column-only
 * grant (`GRANT INSERT (role) ...`), so columns are asked about separately.
 */
const TABLE_PRIVILEGES = sql`array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']`;
const COLUMN_PRIVILEGES = sql`array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']`;
// MAINTAIN exists from Postgres 17; naming it to an older server is an error, not `false`.
const MAINTAIN_SINCE_17 = sql`case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else '{}'::text[] end`;

/** What the connected role is and may do, as the database itself reports it. */
export interface PrivilegeProbe {
  role: string;
  migrated: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  owns_facts: boolean;
  /** `table:PRIVILEGE` for every privilege held on the whole of a matrix table. */
  table_privileges: string[];
  /** `table.column:PRIVILEGE` for every privilege held on a column but not on its table. */
  column_privileges: string[];
  /** Roles it is a member of without inheriting them: reachable only by `SET ROLE`. */
  assumable_roles: string[];
}

/** Everything the role holds that the matrix does not allow, in readable form. */
function excessPrivileges(probe: PrivilegeProbe): string[] {
  const excess: string[] = [];
  for (const held of probe.table_privileges) {
    const [table = '', privilege = ''] = held.split(':');
    if (!PRIVILEGE_MATRIX[table]?.table.includes(privilege)) {
      excess.push(`${privilege} on ${table}`);
    }
  }
  for (const held of probe.column_privileges) {
    const [target = '', privilege = ''] = held.split(':');
    const [table = '', column = ''] = target.split('.');
    // The matrix grants nothing per column except UPDATE, so any other kind is excess.
    const allowed =
      privilege === 'UPDATE' && PRIVILEGE_MATRIX[table]?.updatableColumns.includes(column);
    if (!allowed) excess.push(`${privilege} (${column}) on ${table}`);
  }
  return excess;
}

/**
 * Every reason the connected role is the wrong one to serve requests with. Empty means
 * the role is the constrained application role the design assumes.
 *
 * Pure, so the refusal logic is unit-tested without a database.
 */
export function privilegeViolations(probe: PrivilegeProbe): string[] {
  if (!probe.migrated) {
    return ['the schema is not migrated (session_participants does not exist)'];
  }

  const violations: string[] = [];
  if (probe.rolsuper) violations.push('it is a SUPERUSER, which ignores row-level security');
  if (probe.rolbypassrls) violations.push('it has BYPASSRLS, which ignores row-level security');
  if (probe.owns_facts) {
    violations.push('it owns (or inherits ownership of) the tables, so it can grant itself anything');
  }
  // A superuser or an owner holds every privilege there is; listing them adds nothing.
  if (probe.rolsuper || probe.owns_facts) return violations;

  // has_*_privilege answers for the role as connected. A membership that is not
  // inherited is invisible to it until one `SET ROLE`, which any statement can issue.
  if (probe.assumable_roles.length > 0) {
    violations.push(
      `it can SET ROLE to ${probe.assumable_roles.join(', ')}, whose privileges are not checked`,
    );
  }

  const excess = excessPrivileges(probe);
  if (excess.length > 0) {
    violations.push(`it holds privileges outside the matrix: ${excess.join(', ')}`);
  }
  return violations;
}

/**
 * Refuses to start the API on a database role that voids the guarantees the design
 * rests on. Run from `main.ts` before `listen`, in the same spirit as `loadEnv`.
 *
 * Why this has to be checked rather than trusted: pointing DATABASE_URL at the owner or
 * a superuser breaks NOTHING visibly. Every request still succeeds. RLS is simply not
 * applied, the privilege matrix simply does not bind, and no log line says so -- the
 * application-layer `academy_id` predicates even keep the common paths looking
 * correct. The only way to notice is to ask the database who we are.
 */
export async function assertDatabasePrivileges(database: DatabaseService): Promise<void> {
  const tables = Object.keys(PRIVILEGE_MATRIX);
  const result = await database.runUnscoped((tx) =>
    tx.execute<PrivilegeProbe & Record<string, unknown>>(sql`
      select
        current_user::text as role,
        facts.oid is not null as migrated,
        r.rolsuper,
        r.rolbypassrls,
        coalesce(pg_has_role(current_user, facts.relowner, 'USAGE'), false) as owns_facts,
        coalesce(
          (
            select array_agg(c.relname || ':' || p.privilege order by c.relname, p.privilege)
            from pg_class c
            cross join unnest(${TABLE_PRIVILEGES} || ${MAINTAIN_SINCE_17}) as p(privilege)
            where c.relnamespace = 'public'::regnamespace
              and c.relkind = 'r'
              and c.relname in ${tables}
              and has_table_privilege(current_user, c.oid, p.privilege)
          ),
          '{}'::text[]
        ) as table_privileges,
        coalesce(
          (
            select array_agg(
              c.relname || '.' || a.attname || ':' || p.privilege
              order by c.relname, a.attnum, p.privilege
            )
            from pg_class c
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            cross join unnest(${COLUMN_PRIVILEGES}) as p(privilege)
            where c.relnamespace = 'public'::regnamespace
              and c.relkind = 'r'
              and c.relname in ${tables}
              and not has_table_privilege(current_user, c.oid, p.privilege)
              and has_column_privilege(current_user, c.oid, a.attnum, p.privilege)
          ),
          '{}'::text[]
        ) as column_privileges,
        coalesce(
          (
            select array_agg(o.rolname::text order by o.rolname)
            from pg_roles o
            where o.oid <> r.oid
              and pg_has_role(current_user, o.oid, 'MEMBER')
              and not pg_has_role(current_user, o.oid, 'USAGE')
          ),
          '{}'::text[]
        ) as assumable_roles
      from pg_roles r
      left join pg_class facts on facts.oid = to_regclass('public.session_participants')
      where r.rolname = current_user
    `),
  );

  const probe = result.rows[0];
  if (!probe) throw new Error('Refusing to start: could not read the database role');

  const violations = privilegeViolations(probe);
  if (violations.length > 0) {
    throw new Error(
      `Refusing to start: DATABASE_URL connects as "${probe.role}", which is not a usable ` +
        `application role -- ${violations.join('; ')}. Connect as the non-owner application ` +
        `role (athlete_app) and run the migrations with a separate identity.`,
    );
  }
}
