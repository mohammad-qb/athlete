import { describe, expect, it } from 'vitest';
import {
  assertDatabasePrivileges,
  PRIVILEGE_MATRIX,
  privilegeViolations,
  type PrivilegeProbe,
} from '../src/common/tenancy/database-privileges';
import type { DatabaseService } from '../src/common/tenancy/database.service';

const applicationRole: PrivilegeProbe = {
  role: 'athlete_app',
  migrated: true,
  rolsuper: false,
  rolbypassrls: false,
  owns_facts: false,
  // Exactly what 0002_grants.sql leaves the application role holding.
  table_privileges: Object.entries(PRIVILEGE_MATRIX).flatMap(([table, allowed]) =>
    allowed.table.map((privilege) => `${table}:${privilege}`),
  ),
  column_privileges: Object.entries(PRIVILEGE_MATRIX).flatMap(([table, allowed]) =>
    allowed.updatableColumns.map((column) => `${table}.${column}:UPDATE`),
  ),
  assumable_roles: [],
};

/** A DatabaseService whose one query answers with `rows`. */
const databaseReturning = (rows: PrivilegeProbe[]): DatabaseService =>
  ({
    runUnscoped: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: () => Promise.resolve({ rows }) }),
  }) as unknown as DatabaseService;

describe('boot-time database privilege assertion', () => {
  it('finds nothing wrong with the constrained application role', () => {
    expect(privilegeViolations(applicationRole)).toEqual([]);
  });

  it.each([
    ['rolsuper', /SUPERUSER/],
    ['rolbypassrls', /BYPASSRLS/],
    ['owns_facts', /owns/],
  ] as const)('reports %s as a violation', (flag, message) => {
    const violations = privilegeViolations({ ...applicationRole, [flag]: true });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(message);
  });

  // One sampled table per privilege let a role with DELETE on `assessments` through.
  it.each([
    ['table_privileges', 'assessments:DELETE', /DELETE on assessments/],
    ['table_privileges', 'team_memberships:UPDATE', /UPDATE on team_memberships/],
    ['table_privileges', 'user_academy_roles:INSERT', /INSERT on user_academy_roles/],
    ['table_privileges', 'athletes:TRUNCATE', /TRUNCATE on athletes/],
    ['table_privileges', 'users:SELECT', /SELECT on users/],
    ['table_privileges', 'assessments:TRIGGER', /TRIGGER on assessments/],
    ['column_privileges', 'session_participants.status:UPDATE', /UPDATE \(status\) on session_participants/],
    ['column_privileges', 'team_coach_assignments.valid_from:UPDATE', /UPDATE \(valid_from\) on team_coach/],
    // A column-level grant of any other kind is excess even on a column it may UPDATE.
    ['column_privileges', 'user_academy_roles.role:INSERT', /INSERT \(role\) on user_academy_roles/],
    ['column_privileges', 'users.password_hash:SELECT', /SELECT \(password_hash\) on users/],
    ['column_privileges', 'team_memberships.valid_to:REFERENCES', /REFERENCES \(valid_to\) on team_memberships/],
  ] as const)('reports a privilege outside the matrix: %s %s', (field, held, message) => {
    const probe = { ...applicationRole, [field]: [...applicationRole[field], held] };
    const violations = privilegeViolations(probe);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(message);
  });

  it('reports a role it could SET ROLE to: those privileges are invisible to the probe', () => {
    const violations = privilegeViolations({ ...applicationRole, assumable_roles: ['platform'] });
    expect(violations).toEqual([expect.stringMatching(/SET ROLE to platform/)]);
  });

  it('reports every violation, not just the first', () => {
    const owner = {
      ...applicationRole,
      role: 'postgres',
      rolsuper: true,
      rolbypassrls: true,
      owns_facts: true,
    };
    expect(privilegeViolations(owner)).toHaveLength(3);

    const overGranted = {
      ...applicationRole,
      rolbypassrls: true,
      table_privileges: [...applicationRole.table_privileges, 'assessments:DELETE', 'users:SELECT'],
    };
    expect(privilegeViolations(overGranted)).toEqual([
      expect.stringMatching(/BYPASSRLS/),
      expect.stringMatching(/DELETE on assessments, SELECT on users/),
    ]);
  });

  it('treats an unmigrated database as a refusal, not as a clean role', () => {
    // Before the migrations run there is no table to hold a privilege on, so every
    // flag is false. That must not read as "nothing wrong".
    expect(privilegeViolations({ ...applicationRole, migrated: false })).toEqual([
      expect.stringMatching(/not migrated/),
    ]);
  });

  it('resolves for the application role', async () => {
    await expect(
      assertDatabasePrivileges(databaseReturning([applicationRole])),
    ).resolves.toBeUndefined();
  });

  it('refuses to start on a superuser, naming the role and the reasons', async () => {
    const probe = { ...applicationRole, role: 'postgres', rolsuper: true, owns_facts: true };
    await expect(assertDatabasePrivileges(databaseReturning([probe]))).rejects.toThrow(
      /Refusing to start: DATABASE_URL connects as "postgres".*SUPERUSER.*owns/s,
    );
  });

  it('refuses to start when the role cannot be read at all', async () => {
    await expect(assertDatabasePrivileges(databaseReturning([]))).rejects.toThrow(
      /Refusing to start/,
    );
  });
});
