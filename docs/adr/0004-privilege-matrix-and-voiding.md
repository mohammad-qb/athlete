# 4. A database privilege matrix, and voiding instead of deleting

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

The proposal claimed recorded facts were protected. Three things made that untrue:

1. `0001_rls.sql` granted the application role `SELECT, INSERT, UPDATE, DELETE` on
   every table and made that the default for every future table. One role, full DML,
   including `DELETE` on registers and writes to the role-grant table.
2. `session_participants → training_sessions` and `team_memberships → teams` were
   `ON DELETE CASCADE`. Deleting a session emptied its register.
3. Nothing checked which role the API was connected as. The compose stack connected as
   the `postgres` superuser, so RLS was not applied to any request the smoke script
   made, and every "tenant isolation over HTTP" check was passing on application
   predicates alone.

## Decision

> **The application's database role is granted only what the API should ever ask for.
> Recorded facts are read, appended and voided — never edited, never deleted. The API
> checks its own role at boot and refuses to start holding more.**

- **A per-table matrix** in a forward-only migration (`0002_grants.sql`; `0000` and
  `0001` are not edited). No `DELETE` on any table. Facts get `SELECT`, `INSERT` and
  column-level `UPDATE` on the voiding columns; periods also get `UPDATE (valid_to)`.
  `academies` and `user_academy_roles` are `SELECT` only. `users` gets nothing: it
  holds password hashes and has no tenant policy. The blanket default is revoked, so a
  future table is unreachable until its migration grants on it.
- **Voiding.** `voided_at` and `voided_by` on the three fact tables, tied together by
  a `CHECK` so a void always has an author. The once-per-session uniqueness became a
  partial unique index and the membership exclusion constraint gained
  `where (voided_at is null)`, so a voided row no longer blocks its replacement. One
  shared active-row predicate is applied to every fact read, including the query that
  resolves a coach's scope: a voided membership grants nothing.
- **Final once set.** A column grant says which column, not which transition. A
  trigger lets `valid_to` and the voiding columns go from `NULL` to a value once, for
  every role that does not own the table. Without it the application role could
  reopen a closed coach assignment or un-void a fact. The owner is exempt so the
  platform can repair a row under another identity.
- **`RESTRICT` on the parents of facts**: the session and team foreign keys named
  above, and `team_memberships → athletes`, which cascaded the same history away.
  `academy_id → academies` still cascades everywhere, deliberately.
- **A boot assertion.** Before listening, the API refuses to start if its role is a
  superuser, has `BYPASSRLS`, owns a table, can `SET ROLE` into another role, or holds
  any table- or column-level privilege of any kind beyond the matrix on a table the
  matrix names. An unmigrated or unreachable database is also a refusal.

## Options considered

- **Soft-delete flags enforced by the application** — the same data shape with none of
  the guarantee: the role could still `DELETE`.
- **Editing a fact in place with an audit table** — keeps one row per fact, but the
  truth about what was recorded then lives in a second table that every report must
  remember to join.
- **`status` updatable on register entries** — the plan's wording allowed it. Rejected:
  editing a status in place is precisely what voiding replaces.
- **Sampling one privilege in the boot check** — the first version. Replaced by a
  comparison of the whole matrix after review found that a column-level
  `GRANT INSERT (...)` on the role-grant table passed.

## Consequences

- **Good:** a bug or an injected statement running as the application cannot delete a
  register, mint a role, or read credentials. Pointing `DATABASE_URL` at the owner is
  a refusal to boot instead of a silent loss of RLS.
- **Cost:** a correction is two writes. The matrix exists twice, in the migration and
  in `PRIVILEGE_MATRIX`, so a migration that widens a grant on a matrix table must
  ship after the API version that allows it.
- **Cost:** local and test databases need a second identity. `migrate` runs as the
  owner and gives `athlete_app` a login password when `APP_ROLE_PASSWORD` is set;
  production takes that credential from Key Vault instead.
- **Not built:** a void endpoint. Nothing in the API writes `voided_at`; the
  correction path is proven at the database as the application role. The trigger's
  refusal (SQLSTATE 23000) has no HTTP mapping because no route can reach it.
- **Not checked at boot, on purpose:** `WITH GRANT OPTION`, `CREATE` on the schema,
  function and sequence privileges. None lets the role touch an existing row it could
  not already touch.
- **Stated limit:** revoking the default privilege only undoes `0001`'s default for
  the role that ran `0001`. True for a single migration identity.
- **PDPL:** a deletion request cannot be served by the API deleting rows. It is
  anonymisation of the athlete record, or a platform operation as the owner.
- **Asserted by:** `privileges.matrix.integration`, `database-privileges.unit`,
  `history.transfer.integration`.
